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

  test("browser with fixem=preview gets meta-HTML", async () => {
    const res = await get(makeApp(), "/https://example.com/hello?fixem=preview", BROWSER_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("og:title");
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
