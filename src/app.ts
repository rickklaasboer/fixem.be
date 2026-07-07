import { Hono } from "hono";
import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { MetadataCache } from "./lib/cache";
import type { RateLimitStore } from "./lib/rate-limit";
import { clientIp } from "./lib/rate-limit";
import { isCrawler } from "./ua";
import { parseTargetUrl } from "./url";
import type { Resolver } from "./resolver";
import { minimalMeta, renderMetaHtml } from "./render/meta-html";
import { renderOembed } from "./render/oembed";

export interface AppDeps {
  config: Config;
  logger: Logger;
  cache: MetadataCache;
  resolver: Resolver;
  rateLimitStore: RateLimitStore;
  landingHtml: string;
  now?: () => number;
}

const USAGE_HINT =
  "fixem.be — prepend https://fixem.be/ to a social media URL, e.g. https://fixem.be/https://www.reddit.com/r/pics/comments/abc";

export function buildApp(deps: AppDeps): Hono {
  const { config, logger, cache, resolver, rateLimitStore, landingHtml } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono();

  const oembedUrlFor = (canonicalUrl: string) =>
    `${config.publicBaseUrl}/oembed?url=${encodeURIComponent(canonicalUrl)}`;

  app.get("/", (c) => c.html(landingHtml));

  app.get("/healthz", async (c) => c.json({ ok: true, redis: await cache.ping() }));

  app.get("/oembed", async (c) => {
    const raw = c.req.query("url");
    if (!raw) return c.json({ error: "unknown url" }, 404);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return c.json({ error: "unknown url" }, 404);
    }
    const outcome = await resolver.resolve(url);
    if (outcome.status !== "ok") return c.json({ error: "unknown url" }, 404);
    return c.json(renderOembed(outcome.meta, config.publicBaseUrl));
  });

  app.get("*", async (c) => {
    const parsed = parseTargetUrl(c.req.path, new URL(c.req.url).search.slice(1));
    if (!parsed.ok) return c.text(USAGE_HINT, 400);

    const ua = c.req.header("User-Agent");
    const crawler = isCrawler(ua, config.extraCrawlerUas);
    const preview = c.req.query("fixem") === "preview";

    if (!crawler) {
      // Rate limit everything that isn't a known crawler — including
      // ?fixem=preview, so the debug hatch can't bypass throttling into
      // the resolver (spec §6).
      const hits = await rateLimitStore.hit(clientIp(c.req.raw.headers), 60_000, now());
      if (hits > config.rateLimitPerMin) return c.text("rate limited, try again shortly", 429);
    }

    if (!crawler && !preview) {
      const canonical = resolver.canonicalFor(parsed.url);
      return c.redirect(canonical?.canonicalUrl ?? parsed.url.href, 302);
    }

    const outcome = await resolver.resolve(parsed.url);
    if (outcome.status === "no-adapter") return c.redirect(parsed.url.href, 302);

    const meta =
      outcome.status === "ok" ? outcome.meta : minimalMeta(outcome.canonicalUrl);
    logger.info(
      {
        platform: outcome.platform,
        outcome: outcome.status,
        cache: outcome.status === "ok" ? (outcome.cacheHit ? "hit" : "miss") : "n/a",
        uaClass: crawler ? "crawler" : "preview",
      },
      "embed served",
    );
    // Don't let CDNs pin a transient failure for the full crawler TTL.
    c.header("Cache-Control", outcome.status === "ok" ? "public, max-age=300" : "no-store");
    return c.html(renderMetaHtml(meta, { oembedUrl: oembedUrlFor(outcome.canonicalUrl) }));
  });

  app.onError((err, c) => {
    // Last-resort guard for the global invariant: never 500 on a well-formed URL.
    logger.error({ err: String(err), path: c.req.path }, "unhandled error, degrading");
    const parsed = parseTargetUrl(c.req.path, new URL(c.req.url).search.slice(1));
    if (parsed.ok) return c.redirect(parsed.url.href, 302);
    return c.text(USAGE_HINT, 400);
  });

  return app;
}
