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
      const body = up.body ? up.body.pipeThrough(byteCeiling(config.proxyMaxBytes)) : null;
      return new Response(body, { status: up.status, headers: h });
    } catch (err) {
      logger.warn({ host: target.hostname, err: String(err) }, "proxy fetch failed");
      return c.text("bad gateway", 502);
    } finally {
      clearTimeout(timer);
      inflight--;
    }
  });
}
