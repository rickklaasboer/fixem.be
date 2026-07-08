import { describe, expect, test } from "bun:test";
import { createRedditAdapter } from "../src/adapters/reddit";
import type { FetchFn, PlatformAdapter } from "../src/adapters/types";
import { CHROME_UA } from "../src/lib/http";
import imagePost from "./fixtures/reddit/image-post.json";
import videoPost from "./fixtures/reddit/video-post.json";
import galleryPost from "./fixtures/reddit/gallery-post.json";
import crosspost from "./fixtures/reddit/crosspost.json";

const CREDS = { clientId: "id", clientSecret: "secret" };

function envelope(postData: object) {
  return [
    { kind: "Listing", data: { children: [{ kind: "t3", data: postData }] } },
    { kind: "Listing", data: { children: [] } },
  ];
}

// Adapter on the OAuth JSON path: creds present, token served for the auth call,
// the given post JSON for the API call. Exercises the rich JSON→metadata mapping.
function jsonAdapter(body: unknown): PlatformAdapter {
  const fetchFn = (async (input: unknown) => {
    if (String(input).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as FetchFn;
  return createRedditAdapter(fetchFn, CREDS);
}

// Minimal old.reddit post HTML carrying exactly the tags/attrs the scraper reads.
function oldRedditHtml(opts: {
  title?: string;
  ogImage?: string;
  author?: string;
  subreddit?: string;
  nsfw?: boolean;
  domain?: string;
  dataUrl?: string;
  isGallery?: boolean;
}): string {
  const {
    title = "A title",
    ogImage,
    author = "someone",
    subreddit = "pics",
    nsfw = false,
    domain = "i.redd.it",
    dataUrl = "https://i.redd.it/x.jpg",
    isGallery = false,
  } = opts;
  return (
    `<!doctype html><html><head>` +
    `<meta property="og:title" content="${title}">` +
    (ogImage ? `<meta property="og:image" content="${ogImage}">` : "") +
    `</head><body>` +
    `<div class="thing" data-fullname="t3_abc" data-type="link" data-is-gallery="${isGallery}" ` +
    `data-author="${author}" data-subreddit="${subreddit}" data-url="${dataUrl}" ` +
    `data-domain="${domain}" data-nsfw="${nsfw}"></div>` +
    `</body></html>`
  );
}

function htmlAdapter(html: string, status = 200): PlatformAdapter {
  const fetchFn = (async () => new Response(html, { status })) as unknown as FetchFn;
  return createRedditAdapter(fetchFn); // no creds → HTML path
}

describe("reddit adapter", () => {
  const a = createRedditAdapter();

  test("match covers reddit hosts and redd.it", () => {
    expect(a.match(new URL("https://www.reddit.com/r/pics/comments/abc/x/"))).toBe(true);
    expect(a.match(new URL("https://old.reddit.com/r/pics/comments/abc"))).toBe(true);
    expect(a.match(new URL("https://redd.it/abc123"))).toBe(true);
    expect(a.match(new URL("https://np.reddit.com/r/pics/comments/abc"))).toBe(true);
    expect(a.match(new URL("https://sh.reddit.com/r/pics/s/AbCdEf123"))).toBe(true);
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

  // --- OAuth JSON path (credentials present) ---

  test("json: image post", async () => {
    const m = await jsonAdapter(imagePost).resolve(
      new URL("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/"),
    );
    expect(m.kind).toBe("image");
    expect(m.title).toBe("A sunset over the sea");
    expect(m.image?.url).toBe("https://i.redd.it/sunset123.jpg");
    expect(m.image?.width).toBe(1200);
    expect(m.author?.name).toBe("u/photofan");
    expect(m.siteName).toBe("Reddit • r/pics");
    expect(m.nsfw).toBe(false);
    expect(m.description).toBeUndefined();
  });

  test("json: video post prefers muxed fallback mp4", async () => {
    const m = await jsonAdapter(envelope(videoPost)).resolve(
      new URL("https://www.reddit.com/r/aww/comments/def456/x/"),
    );
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://v.redd.it/xyz789/DASH_720.mp4?source=fallback");
    expect(m.video?.mimeType).toBe("video/mp4");
    expect(m.video?.height).toBe(1280);
    expect(m.image?.url).toBe("https://external-preview.redd.it/poster789.jpg?s=cafe");
  });

  test("json: gallery uses first image and counts items", async () => {
    const m = await jsonAdapter(envelope(galleryPost)).resolve(
      new URL("https://www.reddit.com/r/travel/comments/ghi789/x/"),
    );
    expect(m.kind).toBe("gallery");
    expect(m.image?.url).toBe("https://preview.redd.it/m1.jpg?width=640&s=aa");
    expect(m.description).toBe("Gallery • 3 images — Three days in Lisbon.");
  });

  test("json: single-item gallery uses singular grammar", async () => {
    const single = structuredClone(galleryPost) as { gallery_data: { items: { media_id: string }[] } };
    single.gallery_data.items = single.gallery_data.items.slice(0, 1);
    const m = await jsonAdapter(envelope(single)).resolve(
      new URL("https://www.reddit.com/r/travel/comments/ghi789/x/"),
    );
    expect(m.description).toContain("Gallery • 1 image —");
  });

  test("json: crosspost inherits parent media and keeps own nsfw flag", async () => {
    const m = await jsonAdapter(envelope(crosspost)).resolve(
      new URL("https://www.reddit.com/r/videos/comments/jkl012/x/"),
    );
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://v.redd.it/orig111/DASH_1080.mp4?source=fallback");
    expect(m.image?.url).toBe("https://external-preview.redd.it/xpost-poster.jpg?s=dd");
    expect(m.nsfw).toBe(true);
    expect(m.title).toBe("Crossposted clip");
  });

  test("with creds: acquires token once and fetches via oauth.reddit.com", async () => {
    const requests: { url: string; auth?: string }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, auth: new Headers(init?.headers).get("Authorization") ?? undefined });
      if (url.includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "tok123", expires_in: 3600 }));
      }
      return new Response(JSON.stringify(imagePost));
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn, CREDS);
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
    await expect(
      ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/x/")),
    ).rejects.toThrow();
  });

  test("with creds: share link redirect probe carries bearer, then hits oauth JSON", async () => {
    const probeHeaders: (string | null)[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      if (url.endsWith("/r/pics/s/AbCdEf123")) {
        probeHeaders.push(auth);
        return new Response(null, {
          status: 307,
          headers: { Location: "https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/" },
        });
      }
      return new Response(JSON.stringify(imagePost));
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn, CREDS);
    const m = await ad.resolve(new URL("https://www.reddit.com/r/pics/s/AbCdEf123"));
    expect(probeHeaders).toEqual(["bearer tok"]);
    expect(m.title).toBe("A sunset over the sea");
    expect(m.originalUrl).toBe("https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea");
  });

  // --- Anonymous old.reddit HTML path (no credentials) ---

  test("html: fetches old.reddit and maps an image post", async () => {
    const requests: string[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      requests.push(String(input));
      expect(new Headers(init?.headers).get("User-Agent")).toBe(CHROME_UA);
      return new Response(
        oldRedditHtml({
          title: "A sunset over the sea",
          ogImage: "https://preview.redd.it/sunset.jpeg?width=1080&s=abc",
          author: "photofan",
          subreddit: "pics",
          domain: "i.redd.it",
        }),
      );
    }) as unknown as FetchFn;
    const ad = createRedditAdapter(fetchFn); // no creds
    const m = await ad.resolve(new URL("https://www.reddit.com/r/pics/comments/abc123/a_sunset/"));
    expect(requests[0]).toBe("https://old.reddit.com/r/pics/comments/abc123/a_sunset");
    expect(m.kind).toBe("image");
    expect(m.title).toBe("A sunset over the sea");
    // og:image HTML entities are decoded (&amp; → &)
    expect(m.image?.url).toBe("https://preview.redd.it/sunset.jpeg?width=1080&s=abc");
    expect(m.author?.name).toBe("u/photofan");
    expect(m.siteName).toBe("Reddit • r/pics");
    expect(m.nsfw).toBe(false);
    expect(m.originalUrl).toBe("https://www.reddit.com/r/pics/comments/abc123/a_sunset");
  });

  test("html: nsfw flag read from data-nsfw", async () => {
    const m = await htmlAdapter(
      oldRedditHtml({ nsfw: true, subreddit: "nsfwsub", ogImage: "https://i.redd.it/x.jpg" }),
    ).resolve(new URL("https://www.reddit.com/r/nsfwsub/comments/abc/x/"));
    expect(m.nsfw).toBe(true);
  });

  test("html: gallery post", async () => {
    const m = await htmlAdapter(
      oldRedditHtml({ isGallery: true, domain: "reddit.com", ogImage: "https://preview.redd.it/g1.jpg" }),
    ).resolve(new URL("https://www.reddit.com/r/travel/comments/abc/x/"));
    expect(m.kind).toBe("gallery");
    expect(m.image?.url).toBe("https://preview.redd.it/g1.jpg");
  });

  test("html: v.redd.it video degrades to its poster image (no muxed MP4 without OAuth)", async () => {
    const m = await htmlAdapter(
      oldRedditHtml({ domain: "v.redd.it", dataUrl: "https://v.redd.it/xyz", ogImage: "https://external-preview.redd.it/poster.jpg" }),
    ).resolve(new URL("https://www.reddit.com/r/aww/comments/abc/x/"));
    expect(m.kind).toBe("image");
    expect(m.video).toBeUndefined();
    expect(m.image?.url).toBe("https://external-preview.redd.it/poster.jpg");
  });

  test("html: link post with no preview is a link kind", async () => {
    const m = await htmlAdapter(
      oldRedditHtml({ domain: "example.com", dataUrl: "https://example.com/article", ogImage: undefined }),
    ).resolve(new URL("https://www.reddit.com/r/news/comments/abc/x/"));
    expect(m.kind).toBe("link");
    expect(m.image).toBeUndefined();
  });

  test("html: non-OK response throws (resolver degrades)", async () => {
    await expect(
      htmlAdapter("blocked", 403).resolve(new URL("https://www.reddit.com/r/x/comments/y/z/")),
    ).rejects.toThrow("reddit 403");
  });

  test("html: missing og:title falls back to a subreddit-based title", async () => {
    const html = oldRedditHtml({ subreddit: "pics", ogImage: "https://i.redd.it/x.jpg" }).replace(
      /<meta property="og:title"[^>]*>/,
      "",
    );
    const m = await htmlAdapter(html).resolve(new URL("https://www.reddit.com/r/pics/comments/abc/x/"));
    expect(m.title).toBe("Post from r/pics");
  });
});
