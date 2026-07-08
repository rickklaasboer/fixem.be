import { describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import { MemoryCache, RedisCache } from "../src/lib/cache";

// A RedisClient whose every command rejects — stands in for an unreachable
// Redis (enableOfflineQueue:false rejects immediately in production).
const downClient = { send: async () => { throw new Error("redis down"); } } as unknown as RedisClient;

describe("MemoryCache", () => {
  test("set/get roundtrip", async () => {
    const c = new MemoryCache();
    await c.setEx("k", 60, "v");
    expect(await c.get("k")).toBe("v");
    expect(await c.get("missing")).toBeNull();
  });

  test("entries expire after ttl", async () => {
    let t = 1_000_000;
    const c = new MemoryCache(() => t);
    await c.setEx("k", 10, "v");
    t += 9_999;
    expect(await c.get("k")).toBe("v");
    t += 2;
    expect(await c.get("k")).toBeNull();
  });

  test("ping is true", async () => {
    expect(await new MemoryCache().ping()).toBe(true);
  });
});

describe("RedisCache fail-open (spec §4: a Redis outage never breaks a request)", () => {
  test("get returns null instead of throwing", async () => {
    expect(await new RedisCache(downClient).get("k")).toBeNull();
  });

  test("setEx resolves instead of throwing", async () => {
    await expect(new RedisCache(downClient).setEx("k", 60, "v")).resolves.toBeUndefined();
  });

  test("ping returns false instead of throwing", async () => {
    expect(await new RedisCache(downClient).ping()).toBe(false);
  });
});
