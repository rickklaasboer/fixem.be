import type { Hono } from "hono";
import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { FetchFn } from "./adapters/types";
import type { RateLimitStore } from "./lib/rate-limit";
import { clientIp } from "./lib/rate-limit";
import { verifyProxyToken } from "./lib/proxy-sign";

const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const MAX_REDIRECTS = 3;

// Suffix match on a parsed hostname (exact host or a dot-boundary subdomain).
// Exported so the app can reject at mint time what the proxy would 403 at fetch.
export function isHostAllowed(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase();
  return allowlist.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

// A target URL is proxyable only if it is HTTPS on an allowlisted host. The
// scheme guard blocks plaintext downgrades and non-http schemes (file:, etc.)
// whose "hostname" could otherwise satisfy the allowlist.
function proxyable(url: URL, allowlist: string[]): boolean {
  return url.protocol === "https:" && isHostAllowed(url.hostname, allowlist);
}

// Bound a stream to maxBytes without buffering: errors the stream (→ the client
// sees a truncated/failed transfer) once the ceiling is crossed. Works for
// Range and chunked responses where Content-Length can't be trusted.
function byteCeiling(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new Error("proxy byte ceiling exceeded"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

// Wrap the (byte-ceilinged) upstream body so a slot is released exactly once
// when the transfer actually ends — normal close, upstream error, byte-ceiling
// trip, or client disconnect (stream cancel) — and so a stalled upstream is
// aborted. The handler returns a *lazy* streaming Response, so the concurrency
// slot must be released here (at end-of-transfer), not in the handler's finally
// (which runs the instant the Response is built, before a body byte flows).
// onEnd is idempotent.
function streamProxyBody(
  source: ReadableStream<Uint8Array>,
  onEnd: () => void,
  onStall: () => void,
  idleMs: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const read = reader.read();
        // Idle-read watchdog: an upstream that sent headers then went quiet must
        // not pin this slot forever. The timer runs only while we're actively
        // awaiting a chunk the client has already asked for, so a merely slow
        // *client* (not pulling) never trips it — only a stalled *upstream*.
        const idle = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("proxy idle timeout")), idleMs);
        });
        const { done, value } = await Promise.race([read, idle]);
        if (done) {
          onEnd();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        onStall(); // abort the upstream fetch (no-op if it already ended)
        onEnd();
        controller.error(err);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    cancel(reason) {
      onEnd();
      return reader.cancel(reason);
    },
  });
}

// Declared total size from Content-Length (200) or the "/<total>" of a
// Content-Range (206), or null when unknown (chunked / unsatisfiable).
function declaredLength(res: Response): number | null {
  const cr = res.headers.get("content-range");
  if (cr) {
    const total = cr.split("/")[1];
    const n = total && total !== "*" ? Number(total) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  const len = res.headers.get("content-length");
  const n = len ? Number(len) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function mountProxy(
  app: Hono,
  deps: {
    config: Config;
    logger: Logger;
    rateLimitStore?: RateLimitStore;
    now?: () => number;
    fetchFn?: FetchFn;
  },
): void {
  const { config, logger, rateLimitStore } = deps;
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetchFn ?? fetch;
  let inflight = 0;

  app.get("/v/:token", async (c) => {
    if (!config.proxySecret) return c.text("proxy disabled", 404);

    // Rate limit per client IP — a valid token is replayable for its lifetime,
    // so without this /v/ is an unmetered bandwidth relay for allowlisted CDNs.
    if (rateLimitStore) {
      const hits = await rateLimitStore.hit(clientIp(c.req.raw.headers), 60_000, now());
      if (hits > config.rateLimitPerMin) return c.text("rate limited, try again shortly", 429);
    }

    const payload = await verifyProxyToken(config.proxySecret, c.req.param("token"), now());
    if (!payload) return c.text("not found", 404);

    let target: URL;
    try {
      target = new URL(payload.url);
    } catch {
      return c.text("bad target", 400);
    }
    if (!proxyable(target, config.proxyHostAllowlist)) return c.text("forbidden", 403);

    if (inflight >= config.proxyMaxConcurrent) return c.text("busy", 503);
    inflight++;
    // Release the concurrency slot exactly once. On the streaming success path
    // the body outlives this handler, so its slot is released at end-of-transfer
    // by releaseOnEnd; every other path releases it in the finally below.
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inflight--;
      }
    };
    let streaming = false;
    // Timeout the connect/header phase only — a slow first byte fails fast, but
    // a healthy large stream is not killed mid-body. The byteCeiling bounds size.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.proxyTimeoutMs);
    try {
      const fwd = new Headers(payload.headers);
      const range = c.req.header("Range");
      if (range) fwd.set("Range", range);

      // Follow redirects manually so every hop is re-validated against the
      // allowlist AND the https-only scheme guard — otherwise an allowlisted
      // CDN's 302 could steer the fetch to an internal host or plaintext.
      // TikTok relies on this: its play URL 302s to a signed CDN.
      let current = target;
      let up: Response;
      for (let hop = 0; ; hop++) {
        up = await fetchFn(current.href, {
          headers: fwd,
          redirect: "manual",
          signal: abort.signal,
        });
        if (up.status < 300 || up.status >= 400) break;
        const loc = up.headers.get("location");
        if (!loc || hop >= MAX_REDIRECTS) {
          logger.warn({ host: current.hostname, status: up.status }, "proxy redirect not followable");
          return c.text("bad gateway", 502);
        }
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return c.text("bad gateway", 502);
        }
        if (!proxyable(next, config.proxyHostAllowlist)) {
          logger.warn({ host: next.hostname }, "proxy redirect host not allowed");
          return c.text("forbidden", 403);
        }
        current = next;
      }
      clearTimeout(timer); // headers received — don't abort the body transfer
      if (!up.ok && up.status !== 206) {
        logger.warn({ host: current.hostname, status: up.status }, "proxy upstream error");
        return c.text("bad gateway", 502);
      }
      const total = declaredLength(up);
      if (total !== null && total > config.proxyMaxBytes) {
        return c.text("bad gateway", 502);
      }
      const h = new Headers();
      for (const k of PASS_THROUGH) {
        const v = up.headers.get(k);
        if (v) h.set(k, v);
      }
      h.set("accept-ranges", "bytes");
      h.set("cache-control", "public, max-age=3600");
      if (!up.body) return new Response(null, { status: up.status, headers: h });
      // Hold the concurrency slot until the body finishes streaming — otherwise
      // the counter only bounds the momentary header phase and proxyMaxConcurrent
      // caps nothing (a valid token could then fan out unlimited concurrent
      // large-file streams). The finally must NOT also release it.
      streaming = true;
      const body = streamProxyBody(
        up.body.pipeThrough(byteCeiling(config.proxyMaxBytes)),
        release,
        () => abort.abort(),
        config.proxyTimeoutMs,
      );
      return new Response(body, { status: up.status, headers: h });
    } catch (err) {
      logger.warn({ host: target.hostname, err: String(err) }, "proxy fetch failed");
      return c.text("bad gateway", 502);
    } finally {
      clearTimeout(timer);
      if (!streaming) release();
    }
  });
}
