import { describe, expect, test } from "bun:test";
import { createBlueskyAdapter } from "../src/adapters/bluesky";
import type { FetchFn } from "../src/adapters/types";
import resolveHandle from "./fixtures/bluesky/resolve-handle.json";
import postImages from "./fixtures/bluesky/post-images.json";
import postVideo from "./fixtures/bluesky/post-video.json";
import postQuote from "./fixtures/bluesky/post-quote.json";
import postExternal from "./fixtures/bluesky/post-external.json";

// Routes public.api.bsky.app calls to fixtures; records requested URLs.
function fakeFetch(thread: unknown, requested: string[] = []): FetchFn {
  return (async (input: Parameters<FetchFn>[0]) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("resolveHandle")) return new Response(JSON.stringify(resolveHandle));
    if (url.includes("getPostThread")) return new Response(JSON.stringify(thread));
    return new Response("not found", { status: 404 });
  }) as unknown as FetchFn;
}

const POST_URL = new URL("https://bsky.app/profile/alice.bsky.social/post/3kabc");

describe("bluesky adapter", () => {
  const a = createBlueskyAdapter();

  test("match requires profile/post path shape", () => {
    expect(a.match(POST_URL)).toBe(true);
    expect(a.match(new URL("https://bsky.app/profile/alice.bsky.social"))).toBe(false);
    expect(a.match(new URL("https://bsky.example/profile/a/post/b"))).toBe(false);
  });

  test("canonicalize strips query", () => {
    expect(a.canonicalize(new URL("https://bsky.app/profile/alice.bsky.social/post/3kabc?ref=share"))).toBe(
      "https://bsky.app/profile/alice.bsky.social/post/3kabc",
    );
  });

  test("resolves handle to did, then fetches thread", async () => {
    const requested: string[] = [];
    const ad = createBlueskyAdapter(fakeFetch(postImages, requested));
    const m = await ad.resolve(POST_URL);
    expect(requested[0]).toContain("resolveHandle?handle=alice.bsky.social");
    expect(requested[1]).toContain(encodeURIComponent("at://did:plc:abc123xyz/app.bsky.feed.post/3kabc"));
    expect(m.kind).toBe("image");
    expect(m.title).toBe("Alice (@alice.bsky.social)");
    expect(m.image?.url).toBe("https://cdn.bsky.app/img/feed_fullsize/plain/cat1@jpeg");
    expect(m.image?.width).toBe(2000);
    expect(m.description).toBe("Two cats, one box. 📷 2 images");
    expect(m.siteName).toBe("Bluesky");
  });

  test("did in URL skips handle resolution", async () => {
    const requested: string[] = [];
    const ad = createBlueskyAdapter(fakeFetch(postImages, requested));
    await ad.resolve(new URL("https://bsky.app/profile/did:plc:abc123xyz/post/3kabc"));
    expect(requested.some((u) => u.includes("resolveHandle"))).toBe(false);
  });

  test("video post uses thumbnail image, no video field (HLS)", async () => {
    const ad = createBlueskyAdapter(fakeFetch(postVideo));
    const m = await ad.resolve(new URL("https://bsky.app/profile/bob.bsky.social/post/3kvid"));
    expect(m.kind).toBe("video");
    expect(m.video).toBeUndefined();
    expect(m.image?.url).toBe("https://video.bsky.app/watch/did/xyz/thumbnail.jpg");
    expect(m.title).toBe("▶ Bob (@bob.bsky.social)");
  });

  test("quote post appends quoted text", async () => {
    const ad = createBlueskyAdapter(fakeFetch(postQuote));
    const m = await ad.resolve(new URL("https://bsky.app/profile/carol.bsky.social/post/3kquo"));
    expect(m.description).toBe("This is important: ↪ @dave.bsky.social: Original insight about embeds.");
  });

  test("external embed uses thumb and link title", async () => {
    const ad = createBlueskyAdapter(fakeFetch(postExternal));
    const m = await ad.resolve(new URL("https://bsky.app/profile/erin.bsky.social/post/3kext"));
    expect(m.kind).toBe("link");
    expect(m.image?.url).toBe("https://cdn.bsky.app/img/feed_thumbnail/plain/ext@jpeg");
    expect(m.description).toBe("Good read. 🔗 How embeds work");
  });

  test("not-found thread throws", async () => {
    const ad = createBlueskyAdapter(
      fakeFetch({ thread: { $type: "app.bsky.feed.defs#notFoundPost", notFound: true } }),
    );
    expect(ad.resolve(POST_URL)).rejects.toThrow();
  });

  test("content labels map to nsfw", async () => {
    const labeled = structuredClone(postImages) as { thread: { post: { labels?: { val: string }[] } } };
    labeled.thread.post.labels = [{ val: "porn" }];
    const ad = createBlueskyAdapter(fakeFetch(labeled));
    const m = await ad.resolve(POST_URL);
    expect(m.nsfw).toBe(true);
    // unlabeled fixture stays safe
    const plain = await createBlueskyAdapter(fakeFetch(postImages)).resolve(POST_URL);
    expect(plain.nsfw).toBe(false);
  });

  test("quote of an empty-text post omits the dangling colon", async () => {
    const empty = structuredClone(postQuote) as {
      thread: { post: { embed: { record: { value: { text: string } } } } };
    };
    empty.thread.post.embed.record.value.text = "";
    const ad = createBlueskyAdapter(fakeFetch(empty));
    const m = await ad.resolve(new URL("https://bsky.app/profile/carol.bsky.social/post/3kquo"));
    expect(m.description?.endsWith("↪ @dave.bsky.social")).toBe(true);
  });

  test("empty displayName titles as just @handle", async () => {
    const noName = structuredClone(postImages) as { thread: { post: { author: { displayName?: string } } } };
    noName.thread.post.author.displayName = "";
    const ad = createBlueskyAdapter(fakeFetch(noName));
    const m = await ad.resolve(POST_URL);
    expect(m.title).toBe("@alice.bsky.social");
    expect(m.author?.name).toBe("alice.bsky.social");
  });
});
