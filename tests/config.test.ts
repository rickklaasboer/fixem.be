import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/lib/config";

describe("loadConfig", () => {
  test("applies defaults for empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.redisUrl).toBe("redis://localhost:6379");
    expect(c.cacheTtlSeconds).toBe(14400);
    expect(c.resolveTimeoutMs).toBe(5000);
    expect(c.rateLimitPerMin).toBe(60);
    expect(c.publicBaseUrl).toBe("https://fixem.be");
    expect(c.extraCrawlerUas).toEqual([]);
  });

  test("reads overrides and parses extra UAs", () => {
    const c = loadConfig({
      PORT: "8080",
      CACHE_TTL_SECONDS: "60",
      EXTRA_CRAWLER_UAS: "MyBot, OtherBot",
      TWITCH_CLIENT_ID: "abc",
    });
    expect(c.port).toBe(8080);
    expect(c.cacheTtlSeconds).toBe(60);
    expect(c.extraCrawlerUas).toEqual(["mybot", "otherbot"]);
    expect(c.twitchClientId).toBe("abc");
  });

  test("falls back to default on non-numeric value", () => {
    expect(loadConfig({ PORT: "banana" }).port).toBe(3000);
  });
});
