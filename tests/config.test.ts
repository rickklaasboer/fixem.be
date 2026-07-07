import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/lib/config";
import { TWITCH_GQL_DEFAULTS } from "../src/adapters/twitch";

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
    expect(c.twitchGqlClientId).toBe(TWITCH_GQL_DEFAULTS.clientId);
    expect(c.twitchGqlClipHash).toBe(TWITCH_GQL_DEFAULTS.clipTokenHash);
  });

  test("reads overrides and parses extra UAs", () => {
    const c = loadConfig({
      PORT: "8080",
      CACHE_TTL_SECONDS: "60",
      EXTRA_CRAWLER_UAS: "MyBot, OtherBot",
      TWITCH_CLIENT_ID: "abc",
      REDDIT_CLIENT_ID: "rid",
      REDDIT_CLIENT_SECRET: "rsecret",
    });
    expect(c.port).toBe(8080);
    expect(c.cacheTtlSeconds).toBe(60);
    expect(c.extraCrawlerUas).toEqual(["mybot", "otherbot"]);
    expect(c.twitchClientId).toBe("abc");
    expect(c.redditClientId).toBe("rid");
    expect(c.redditClientSecret).toBe("rsecret");
  });

  test("falls back to default on non-numeric value", () => {
    expect(loadConfig({ PORT: "banana" }).port).toBe(3000);
  });

  test("falls back to default on values below the sane floor", () => {
    expect(loadConfig({ RATE_LIMIT_PER_MIN: "-1" }).rateLimitPerMin).toBe(60);
    expect(loadConfig({ RESOLVE_TIMEOUT_MS: "0" }).resolveTimeoutMs).toBe(5000);
  });
});
