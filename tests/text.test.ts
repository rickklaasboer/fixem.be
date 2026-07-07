import { describe, expect, test } from "bun:test";
import { truncate } from "../src/lib/text";

describe("truncate", () => {
  test("short strings pass through trimmed", () => {
    expect(truncate("  hello  ", 300)).toBe("hello");
  });
  test("long strings cut on word boundary with ellipsis", () => {
    const out = truncate("aaa bbb ccc ddd", 11);
    expect(out).toBe("aaa bbb…");
    expect(out.length).toBeLessThanOrEqual(11);
  });
  test("unbreakable strings hard-cut", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });
});
