import { describe, expect, test } from "bun:test";
import { buildApp, type AppDeps } from "../src/app";
import { loadConfig } from "../src/lib/config";
import { createLogger } from "../src/lib/logger";
import { MemoryCache } from "../src/lib/cache";
import { MemoryRateLimitStore } from "../src/lib/rate-limit";
import { Resolver } from "../src/resolver";
import { AdapterRegistry } from "../src/adapters/registry";
import { createDummyAdapter } from "../src/adapters/dummy";

const DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

function makeApp(overrides: Partial<AppDeps> = {}) {
  const config = loadConfig({});
  const logger = createLogger({ write: () => {} });
  const cache = new MemoryCache();
  const resolver = new Resolver({
    registry: new AdapterRegistry([createDummyAdapter()]),
    cache,
    logger,
    ttlSeconds: config.cacheTtlSeconds,
    timeoutMs: config.resolveTimeoutMs,
  });
  return buildApp({
    config,
    logger,
    cache,
    resolver,
    rateLimitStore: new MemoryRateLimitStore(),
    landingHtml: "<html>fixem.be landing</html>",
    ...overrides,
  });
}

function get(app: ReturnType<typeof makeApp>, path: string, ua: string) {
  return app.request(path, { headers: { "User-Agent": ua } });
}

describe("routes", () => {
  test("GET / serves landing page", async () => {
    const res = await get(makeApp(), "/", BROWSER_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("fixem.be landing");
  });

  test("GET /healthz reports redis status", async () => {
    const res = await get(makeApp(), "/healthz", BROWSER_UA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redis: true });
  });

  test("crawler gets meta-HTML for matched URL", async () => {
    const res = await get(makeApp(), "/https://example.com/hello", DISCORD_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('og:title');
    expect(html).toContain("fixem.be works!");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  test("browser gets 302 to canonical URL for matched URL", async () => {
    const res = await get(makeApp(), "/https://www.example.com/hello?utm=1", BROWSER_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/hello");
  });

  test("browser with fixem=preview gets meta-HTML without meta refresh", async () => {
    const res = await get(makeApp(), "/https://example.com/hello?fixem=preview", BROWSER_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("og:title");
    // Preview is for inspecting the HTML in a browser; it must not
    // instantly navigate away.
    expect(html).not.toContain('http-equiv="refresh"');
  });

  test("crawler meta-HTML keeps the meta refresh", async () => {
    const res = await get(makeApp(), "/https://example.com/hello", DISCORD_UA);
    expect(await res.text()).toContain('http-equiv="refresh"');
  });

  test("unmatched valid URL redirects for both crawler and browser", async () => {
    const a = await get(makeApp(), "/https://unknown-platform.dev/x", DISCORD_UA);
    expect(a.status).toBe(302);
    expect(a.headers.get("Location")).toBe("https://unknown-platform.dev/x");
    const b = await get(makeApp(), "/https://unknown-platform.dev/x", BROWSER_UA);
    expect(b.status).toBe(302);
  });

  test("garbage path is 400 with hint, never 500", async () => {
    const res = await get(makeApp(), "/favicon.ico", BROWSER_UA);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("fixem.be");
  });

  test("oembed returns author/provider for matched URL", async () => {
    const res = await get(makeApp(), "/oembed?url=" + encodeURIComponent("https://example.com/hello"), DISCORD_UA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider_name).toBe("example.com");
    expect(body.version).toBe("1.0");
  });

  test("oembed 404s for unknown or missing url", async () => {
    expect((await get(makeApp(), "/oembed?url=https://unknown.dev/x", DISCORD_UA)).status).toBe(404);
    expect((await get(makeApp(), "/oembed", DISCORD_UA)).status).toBe(404);
  });

  test("browser requests are rate limited, crawlers exempt", async () => {
    const config = loadConfig({ RATE_LIMIT_PER_MIN: "2" });
    const app = makeApp({ config });
    const path = "/https://example.com/hello";
    expect((await get(app, path, BROWSER_UA)).status).toBe(302);
    expect((await get(app, path, BROWSER_UA)).status).toBe(302);
    expect((await get(app, path, BROWSER_UA)).status).toBe(429);
    expect((await get(app, path, DISCORD_UA)).status).toBe(200); // crawler unaffected
  });

  test("oembed is rate limited for browsers, crawlers exempt", async () => {
    const config = loadConfig({ RATE_LIMIT_PER_MIN: "1" });
    const app = makeApp({ config });
    const path = "/oembed?url=https%3A%2F%2Fexample.com%2Fhello";
    expect((await get(app, path, BROWSER_UA)).status).toBe(200);
    expect((await get(app, path, BROWSER_UA)).status).toBe(429);
    expect((await get(app, path, DISCORD_UA)).status).toBe(200); // crawler unaffected
  });

  test("fixem=preview is rate limited like a browser", async () => {
    const config = loadConfig({ RATE_LIMIT_PER_MIN: "1" });
    const app = makeApp({ config });
    const path = "/https://example.com/hello?fixem=preview";
    expect((await get(app, path, BROWSER_UA)).status).toBe(200);
    expect((await get(app, path, BROWSER_UA)).status).toBe(429);
  });

  test("degraded resolve serves minimal embed to crawler", async () => {
    const config = loadConfig({});
    const logger = createLogger({ write: () => {} });
    const cache = new MemoryCache();
    const failing = {
      name: "broken",
      match: (u: URL) => u.hostname === "broken.test",
      canonicalize: (u: URL) => `https://broken.test${u.pathname}`,
      resolve: async () => {
        throw new Error("scraper died");
      },
    };
    const resolver = new Resolver({
      registry: new AdapterRegistry([failing]),
      cache,
      logger,
      ttlSeconds: 60,
      timeoutMs: 100,
    });
    const app = makeApp({ resolver });
    const res = await get(app, "/https://broken.test/post/1", DISCORD_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('content="https://broken.test/post/1"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

test("reddit URL routes through app with fixture-backed adapter", async () => {
  const { createRedditAdapter } = await import("../src/adapters/reddit");
  const imagePost = (await import("./fixtures/reddit/image-post.json")).default;
  const fetchFn = (async () => new Response(JSON.stringify(imagePost))) as unknown as typeof fetch;
  const config = loadConfig({});
  const logger = createLogger({ write: () => {} });
  const cache = new MemoryCache();
  const resolver = new Resolver({
    registry: new AdapterRegistry([createRedditAdapter(fetchFn)]),
    cache,
    logger,
    ttlSeconds: 60,
    timeoutMs: 1000,
  });
  const app = makeApp({ resolver });
  const res = await get(app, "/https://old.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/?utm=1", DISCORD_UA);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("A sunset over the sea");
  expect(html).toContain("Reddit • r/pics");
  // browser hits canonical
  const red = await get(app, "/https://old.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/", BROWSER_UA);
  expect(red.headers.get("Location")).toBe("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea");
});

test("tiktok URL routes through the full app with a fixture-backed adapter", async () => {
  const { createTiktokAdapter, TIKTOK_DEFAULTS } = await import("../src/adapters/tiktok");
  const fixture = (await import("./fixtures/tiktok/universal-video.json")).default;
  // TikTok ships the post JSON inside a <script> tag in the page HTML.
  const page =
    `<!doctype html><html><body>` +
    `<script id="${TIKTOK_DEFAULTS.rehydrationScriptId}" type="application/json">${JSON.stringify(fixture)}</script>` +
    `</body></html>`;
  const fetchFn = (async () => new Response(page, { status: 200 })) as unknown as typeof fetch;
  const config = loadConfig({ PROXY_SECRET: "s", PUBLIC_BASE_URL: "https://fixem.be" });
  const logger = createLogger({ write: () => {} });
  const cache = new MemoryCache();
  const resolver = new Resolver({
    registry: new AdapterRegistry([createTiktokAdapter(fetchFn)]),
    cache,
    logger,
    ttlSeconds: 60,
    timeoutMs: 1000,
  });
  const app = makeApp({ config, resolver });
  const res = await get(app, "/https://www.tiktok.com/@janetravels/video/7311234567890123456", DISCORD_UA);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Jane Traveler (@janetravels)");
  expect(html).toContain("TikTok");
  // inline video is wrapped in the signed /v/ proxy; raw CDN URL never exposed
  const m = html.match(/og:video" content="([^"]+)"/);
  expect(m?.[1]).toStartWith("https://fixem.be/v/");
  expect(html).not.toContain("v16-webapp.tiktokcdn.com");
});

test("proxied video is rewritten to a signed /v/ URL", async () => {
  const config = loadConfig({ PROXY_SECRET: "s", PUBLIC_BASE_URL: "https://fixem.be" });
  const logger = createLogger({ write: () => {} });
  const cache = new MemoryCache();
  const proxAdapter = {
    name: "prox",
    match: (u: URL) => u.hostname === "prox.test",
    canonicalize: (u: URL) => `https://prox.test${u.pathname}`,
    resolve: async () => ({
      kind: "video" as const,
      title: "vid",
      siteName: "Prox",
      originalUrl: "https://prox.test/1",
      video: {
        url: "https://v16.tiktokcdn.com/a.mp4",
        mimeType: "video/mp4",
        proxyHeaders: { Referer: "https://www.tiktok.com/" },
      },
    }),
  };
  const resolver = new Resolver({
    registry: new AdapterRegistry([proxAdapter]),
    cache,
    logger,
    ttlSeconds: 60,
    timeoutMs: 1000,
  });
  const app = makeApp({ config, resolver });
  const res = await get(app, "/https://prox.test/1", DISCORD_UA);
  const html = await res.text();
  const m = html.match(/og:video" content="([^"]+)"/);
  expect(m?.[1]).toStartWith("https://fixem.be/v/");
  expect(html).not.toContain("v16.tiktokcdn.com"); // raw CDN URL never exposed
});

test("proxy-required video drops to link when PROXY_SECRET unset", async () => {
  const config = loadConfig({}); // no PROXY_SECRET
  const logger = createLogger({ write: () => {} });
  const cache = new MemoryCache();
  const proxAdapter = {
    name: "prox",
    match: (u: URL) => u.hostname === "prox.test",
    canonicalize: (u: URL) => `https://prox.test${u.pathname}`,
    resolve: async () => ({
      kind: "video" as const,
      title: "vid",
      siteName: "Prox",
      originalUrl: "https://prox.test/1",
      video: { url: "https://v16.tiktokcdn.com/a.mp4", mimeType: "video/mp4", proxyHeaders: { Referer: "x" } },
    }),
  };
  const resolver = new Resolver({
    registry: new AdapterRegistry([proxAdapter]),
    cache, logger, ttlSeconds: 60, timeoutMs: 1000,
  });
  const res = await get(makeApp({ config, resolver }), "/https://prox.test/1", DISCORD_UA);
  const html = await res.text();
  expect(html).not.toContain("og:video");
  expect(html).not.toContain("tiktokcdn");
});
