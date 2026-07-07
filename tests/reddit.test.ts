import { describe, expect, test } from "bun:test";
import { createRedditAdapter } from "../src/adapters/reddit";
import type { FetchFn } from "../src/adapters/types";
import imagePost from "./fixtures/reddit/image-post.json";
import videoPost from "./fixtures/reddit/video-post.json";
import galleryPost from "./fixtures/reddit/gallery-post.json";
import crosspost from "./fixtures/reddit/crosspost.json";

function envelope(postData: object) {
  return [
    { kind: "Listing", data: { children: [{ kind: "t3", data: postData }] } },
    { kind: "Listing", data: { children: [] } },
  ];
}

function fetchReturning(body: unknown, status = 200): FetchFn {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as FetchFn;
}

describe("reddit adapter", () => {
  const a = createRedditAdapter();

  test("match covers reddit hosts and redd.it", () => {
    expect(a.match(new URL("https://www.reddit.com/r/pics/comments/abc/x/"))).toBe(true);
    expect(a.match(new URL("https://old.reddit.com/r/pics/comments/abc"))).toBe(true);
    expect(a.match(new URL("https://redd.it/abc123"))).toBe(true);
    expect(a.match(new URL("https://redditstatus.com/x"))).toBe(false);
  });

  test("canonicalize normalizes host, strips query and trailing slash", () => {
    expect(a.canonicalize(new URL("https://old.reddit.com/r/pics/comments/abc/x/?utm=1"))).toBe(
      "https://www.reddit.com/r/pics/comments/abc/x",
    );
    expect(a.canonicalize(new URL("https://redd.it/abc123"))).toBe(
      "https://www.reddit.com/comments/abc123",
    );
  });

  test("image post", async () => {
    const ad = createRedditAdapter(fetchReturning(imagePost));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/"));
    expect(m.kind).toBe("image");
    expect(m.title).toBe("A sunset over the sea");
    expect(m.image?.url).toBe("https://i.redd.it/sunset123.jpg");
    expect(m.image?.width).toBe(1200);
    expect(m.author?.name).toBe("u/photofan");
    expect(m.siteName).toBe("Reddit • r/pics");
    expect(m.nsfw).toBe(false);
    expect(m.description).toBeUndefined();
  });

  test("video post prefers muxed fallback mp4", async () => {
    const ad = createRedditAdapter(fetchReturning(envelope(videoPost)));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/aww/comments/def456/x/"));
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://v.redd.it/xyz789/DASH_720.mp4?source=fallback");
    expect(m.video?.mimeType).toBe("video/mp4");
    expect(m.video?.height).toBe(1280);
    expect(m.image?.url).toBe("https://external-preview.redd.it/poster789.jpg?s=cafe");
  });

  test("gallery uses first image and counts items", async () => {
    const ad = createRedditAdapter(fetchReturning(envelope(galleryPost)));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/travel/comments/ghi789/x/"));
    expect(m.kind).toBe("gallery");
    expect(m.image?.url).toBe("https://preview.redd.it/m1.jpg?width=640&s=aa");
    expect(m.description).toBe("Gallery • 3 images — Three days in Lisbon.");
  });

  test("crosspost inherits parent media and keeps own nsfw flag", async () => {
    const ad = createRedditAdapter(fetchReturning(envelope(crosspost)));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/videos/comments/jkl012/x/"));
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://v.redd.it/orig111/DASH_1080.mp4?source=fallback");
    expect(m.nsfw).toBe(true);
    expect(m.title).toBe("Crossposted clip");
  });

  test("non-OK response throws", async () => {
    const ad = createRedditAdapter(fetchReturning({ error: 429 }, 429));
    expect(ad.resolve(new URL("https://www.reddit.com/r/x/comments/y/z/"))).rejects.toThrow("reddit 429");
  });
});
