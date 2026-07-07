import type { Hono } from "hono";
import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { FetchFn } from "./adapters/types";
import { verifyProxyToken } from "./lib/proxy-sign";

const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const MAX_REDIRECTS = 3;

export function mountProxy(
  app: Hono,
  deps: { config: Config; logger: Logger; now?: () => number; fetchFn?: FetchFn },
): void {
  const { config, logger } = deps;
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetchFn ?? fetch;
  let inflight = 0;

  function hostAllowed(host: string): boolean {
    const h = host.toLowerCase();
    return config.proxyHostAllowlist.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
  }

  app.get("/v/:token", async (c) => {
    if (!config.proxySecret) return c.text("proxy disabled", 404);
    const payload = await verifyProxyToken(config.proxySecret, c.req.param("token"), now());
    if (!payload) return c.text("not found", 404);

    let target: URL;
    try {
      target = new URL(payload.url);
    } catch {
      return c.text("bad target", 400);
    }
    if (!hostAllowed(target.hostname)) return c.text("forbidden", 403);

    if (inflight >= config.proxyMaxConcurrent) return c.text("busy", 503);
    inflight++;
    try {
      const fwd = new Headers(payload.headers);
      const range = c.req.header("Range");
      if (range) fwd.set("Range", range);

      // Follow redirects manually so every hop's host is re-validated against
      // the allowlist — otherwise an allowlisted CDN's 302 could steer the
      // fetch to an internal host (e.g. cloud metadata). TikTok relies on this:
      // its play URL 302s to a signed CDN, which is itself allowlisted.
      let current = target;
      let up: Response;
      for (let hop = 0; ; hop++) {
        up = await fetchFn(current.href, {
          headers: fwd,
          redirect: "manual",
          signal: AbortSignal.timeout(config.proxyTimeoutMs),
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
        if (!hostAllowed(next.hostname)) {
          logger.warn({ host: next.hostname }, "proxy redirect host not allowed");
          return c.text("forbidden", 403);
        }
        current = next;
      }
      if (!up.ok && up.status !== 206) {
        logger.warn({ host: current.hostname, status: up.status }, "proxy upstream error");
        return c.text("bad gateway", 502);
      }
      const len = up.headers.get("content-length");
      if (up.status === 200 && len && Number(len) > config.proxyMaxBytes) {
        return c.text("bad gateway", 502);
      }
      const h = new Headers();
      for (const k of PASS_THROUGH) {
        const v = up.headers.get(k);
        if (v) h.set(k, v);
      }
      h.set("accept-ranges", "bytes");
      h.set("cache-control", "public, max-age=3600");
      return new Response(up.body, { status: up.status, headers: h });
    } catch (err) {
      logger.warn({ host: target.hostname, err: String(err) }, "proxy fetch failed");
      return c.text("bad gateway", 502);
    } finally {
      inflight--;
    }
  });
}
