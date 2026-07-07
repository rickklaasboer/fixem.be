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

  test("single-item gallery uses singular grammar", async () => {
    const single = structuredClone(galleryPost) as {
      gallery_data: { items: { media_id: string }[] };
    };
    single.gallery_data.items = single.gallery_data.items.slice(0, 1);
    const ad = createRedditAdapter(fetchReturning(envelope(single)));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/travel/comments/ghi789/x/"));
    expect(m.description).toContain("Gallery • 1 image —");
  });

  test("crosspost inherits parent media and keeps own nsfw flag", async () => {
    const ad = createRedditAdapter(fetchReturning(envelope(crosspost)));
    const m = await ad.resolve(new URL("https://www.reddit.com/r/videos/comments/jkl012/x/"));
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://v.redd.it/orig111/DASH_1080.mp4?source=fallback");
    // child's regenerated preview must not block inheritance; it becomes the poster
    expect(m.image?.url).toBe("https://external-preview.redd.it/xpost-poster.jpg?s=dd");
    expect(m.nsfw).toBe(true);
    expect(m.title).toBe("Crossposted clip");
  });

  test("match covers np and sh reddit hosts", () => {
    expect(a.match(new URL("https://np.reddit.com/r/pics/comments/abc"))).toBe(true);
    expect(a.match(new URL("https://sh.reddit.com/r/pics/s/AbCdEf123"))).toBe(true);
  });

  test("mobile share link follows manual redirect to the permalink", async () => {
    let calls = 0;
    const fetchFn = (async (input: Parameters<FetchFn>[0], init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        expect(String(input)).toBe("https://www.reddit.com/r/pics/s/AbCdEf123");
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 307,
          headers: {
            Location:
              "https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/?utm_source=share",
          },
        });
      }
      expect(String(input)).toBe(
        "https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea.json?raw_json=1",
      );
      return new Response(JSON.stringify(imagePost));
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn);
    const m = await ad.resolve(new URL("https://www.reddit.com/r/pics/s/AbCdEf123"));
    expect(m.title).toBe("A sunset over the sea");
    expect(m.originalUrl).toBe("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea");
  });

  test("share link without redirect throws", async () => {
    const ad = createRedditAdapter(fetchReturning({}, 200));
    expect(ad.resolve(new URL("https://www.reddit.com/r/pics/s/AbCdEf123"))).rejects.toThrow(
      "reddit: share link did not redirect",
    );
  });

  test("non-OK response throws", async () => {
    const ad = createRedditAdapter(fetchReturning({ error: 429 }, 429));
    expect(ad.resolve(new URL("https://www.reddit.com/r/x/comments/y/z/"))).rejects.toThrow("reddit 429");
  });

  test("with creds: acquires token once and fetches via oauth.reddit.com", async () => {
    const requests: { url: string; auth?: string }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, auth: headers.get("Authorization") ?? undefined });
      if (url.includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "tok123", expires_in: 3600 }));
      }
      return new Response(JSON.stringify(imagePost));
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn, { clientId: "id", clientSecret: "secret" });
    await ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/"));
    await ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/other/"));
    const tokenCalls = requests.filter((r) => r.url.includes("access_token"));
    expect(tokenCalls.length).toBe(1);
    expect(tokenCalls[0]!.auth?.startsWith("Basic ")).toBe(true);
    const apiCalls = requests.filter((r) => r.url.startsWith("https://oauth.reddit.com/"));
    expect(apiCalls.length).toBe(2);
    expect(apiCalls[0]!.url).toBe("https://oauth.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea.json?raw_json=1");
    expect(apiCalls[0]!.auth).toBe("bearer tok123");
  });

  test("with creds: failed token acquisition throws (resolver degrades)", async () => {
    const fetchFn = (async (input: unknown) => {
      if (String(input).includes("access_token")) return new Response("nope", { status: 401 });
      return new Response(JSON.stringify(imagePost));
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn, { clientId: "id", clientSecret: "bad" });
    expect(ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/x/"))).rejects.toThrow();
  });
});
