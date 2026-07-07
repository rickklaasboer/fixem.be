import { describe, expect, test } from "bun:test";
import { MemoryCache } from "../src/lib/cache";

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
