import { describe, expect, test } from "bun:test";
import { parseSnapsave, deobfuscateSnapsave, fetchSnapsaveMedia } from "../src/adapters/snapsave";
import type { FetchFn } from "../src/adapters/types";

// A real recorded snapsave.app response (a photo post). Guards the obfuscation
// decoder against regressions — if snapsave rotates its scheme, this fails loudly.
const blob = await Bun.file(
  new URL("./fixtures/instagram/snapsave-response.txt", import.meta.url),
).text();

describe("snapsave decoder", () => {
  test("deobfuscates the recorded blob to HTML containing rapidcdn links", () => {
    const html = deobfuscateSnapsave(blob);
    expect(html).not.toBeNull();
    expect(html!).toContain("d.rapidcdn.app/v2");
  });

  test("parses the recorded blob into a media descriptor", () => {
    const media = parseSnapsave(blob);
    expect(media).not.toBeNull();
    expect(media!.kind).toBe("image"); // the recorded post is a photo
    expect(media!.mediaUrl.startsWith("https://d.rapidcdn.app/v2?token=")).toBe(true);
    expect(media!.count).toBeGreaterThanOrEqual(1);
  });

  test("returns null on a non-snapsave / malformed blob (no crash)", () => {
    expect(parseSnapsave("<html>totally unrelated</html>")).toBeNull();
    expect(deobfuscateSnapsave("garbage")).toBeNull();
  });

  test("fetchSnapsaveMedia POSTs the IG url and parses the response", async () => {
    let seenBody: string | undefined;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seenBody = init?.body?.toString();
      return new Response(blob, { status: 200 });
    }) as unknown as FetchFn;
    const media = await fetchSnapsaveMedia("https://www.instagram.com/p/DaNQAubIQm_/", fetchFn);
    expect(seenBody).toContain(encodeURIComponent("https://www.instagram.com/p/DaNQAubIQm_/"));
    expect(media?.mediaUrl).toContain("rapidcdn.app");
  });

  test("fetchSnapsaveMedia returns null on transport failure (no throw)", async () => {
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as FetchFn;
    expect(await fetchSnapsaveMedia("https://www.instagram.com/p/x/", boom)).toBeNull();
  });
});
