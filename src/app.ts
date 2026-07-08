import { Hono } from "hono";
import type { Config } from "./lib/config";
import type { Logger } from "./lib/logger";
import type { MetadataCache } from "./lib/cache";
import type { RateLimitStore } from "./lib/rate-limit";
import { clientIp } from "./lib/rate-limit";
import { isCrawler } from "./ua";
import { parseTargetUrl } from "./url";
import type { Resolver } from "./resolver";
import { minimalMeta, renderMetaHtml, renderPreviewNoAdapter, renderPreviewReport } from "./render/meta-html";
import { renderOembed } from "./render/oembed";
import { mountProxy, isHostAllowed } from "./proxy";
import { signProxyToken } from "./lib/proxy-sign";
import type { EmbedMetadata } from "./adapters/types";

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

  const PROXY_TOKEN_TTL_MS = 3_600_000;
  function dropVideo(meta: EmbedMetadata): EmbedMetadata {
    const { video, ...rest } = meta;
    return { ...rest, kind: meta.kind === "video" ? "link" : meta.kind };
  }
  async function withProxiedVideo(meta: EmbedMetadata): Promise<EmbedMetadata> {
    if (!meta.video?.proxyHeaders) return meta;
    // Proxy required but disabled → drop rather than emit an unplayable CDN URL.
    if (!config.proxySecret) return dropVideo(meta);
    // The /v/ route only fetches https allowlisted hosts, so a video whose host
    // isn't allowlisted would mint a token that always 403s — a player that
    // fails to load is worse than an honest thumbnail/link. Degrade + warn so
    // allowlist drift is visible instead of silently broken in Discord.
    let u: URL;
    try {
      u = new URL(meta.video.url);
    } catch {
      return dropVideo(meta);
    }
    if (u.protocol !== "https:" || !isHostAllowed(u.hostname, config.proxyHostAllowlist)) {
      logger.warn({ host: u.hostname }, "video host not proxyable (not https/allowlisted) — degrading to link");
      return dropVideo(meta);
    }
    const token = await signProxyToken(config.proxySecret, {
      url: meta.video.url,
      headers: meta.video.proxyHeaders,
      exp: now() + PROXY_TOKEN_TTL_MS,
    });
    const { proxyHeaders, ...vid } = meta.video;
    return { ...meta, video: { ...vid, url: `${config.publicBaseUrl}/v/${token}` } };
  }

  app.get("/", (c) => c.html(landingHtml));

  app.get("/healthz", async (c) => c.json({ ok: true, redis: await cache.ping() }));

  app.get("/oembed", async (c) => {
    if (!isCrawler(c.req.header("User-Agent"), config.extraCrawlerUas)) {
      const hits = await rateLimitStore.hit(clientIp(c.req.raw.headers), 60_000, now());
      if (hits > config.rateLimitPerMin) return c.text("rate limited, try again shortly", 429);
    }
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

  mountProxy(app, { config, logger, rateLimitStore, now });

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
      logger.info(
        { platform: canonical?.platform ?? "none", outcome: "redirect", uaClass: "browser" },
        "redirected",
      );
      return c.redirect(canonical?.canonicalUrl ?? parsed.url.href, 302);
    }

    const outcome = await resolver.resolve(parsed.url);
    if (outcome.status === "no-adapter") {
      // Crawlers get a bare redirect (no embed to build). Under ?fixem=preview,
      // that redirect is invisible/confusing when debugging, so show why instead.
      if (preview) return c.html(renderPreviewNoAdapter(parsed.url.href));
      return c.redirect(parsed.url.href, 302);
    }

    const meta =
      outcome.status === "ok"
        ? await withProxiedVideo(outcome.meta)
        : minimalMeta(outcome.canonicalUrl);
    logger.info(
      {
        platform: outcome.platform,
        outcome: outcome.status,
        cache: outcome.status === "ok" ? (outcome.cacheHit ? "hit" : "miss") : "n/a",
        uaClass: crawler ? "crawler" : "preview",
      },
      "embed served",
    );
    // Preview is a human-facing debug view: render the full diagnostic report
    // (outcome, visual card, parsed metadata, exact crawler HTML) and never cache
    // it. Crawlers get the plain meta HTML.
    if (preview) {
      c.header("Cache-Control", "no-store");
      return c.html(
        renderPreviewReport({
          platform: outcome.platform,
          status: outcome.status,
          cacheHit: outcome.status === "ok" ? outcome.cacheHit : undefined,
          reason: outcome.status === "degraded" ? outcome.reason : undefined,
          canonicalUrl: outcome.canonicalUrl,
          meta,
          oembedUrl: oembedUrlFor(outcome.canonicalUrl),
        }),
      );
    }
    // Don't let CDNs pin a transient failure for the full crawler TTL.
    c.header("Cache-Control", outcome.status === "ok" ? "public, max-age=300" : "no-store");
    return c.html(renderMetaHtml(meta, { oembedUrl: oembedUrlFor(outcome.canonicalUrl), refresh: true }));
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
