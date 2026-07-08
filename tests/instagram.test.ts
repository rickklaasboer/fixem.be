import { describe, expect, test } from "bun:test";
import { createInstagramAdapter, INSTAGRAM_DEFAULTS } from "../src/adapters/instagram";
import type { FetchFn } from "../src/adapters/types";
import { CHROME_UA } from "../src/lib/http";
import imageFixture from "./fixtures/instagram/graphql-image.json";
import videoFixture from "./fixtures/instagram/graphql-video.json";

interface Recorded {
  url: string;
  body?: string;
  headers: Headers;
}

// Routes the single GraphQL POST to a fixture (or a raw body / status, for the
// login-wall degrade cases). No live network — `as unknown as FetchFn`.
function fakeFetch(
  opts: { body?: unknown; raw?: string; status?: number; recorded?: Recorded[] } = {},
): FetchFn {
  return (async (input: unknown, init?: RequestInit) => {
    opts.recorded?.push({
      url: String(input),
      body: init?.body?.toString(),
      headers: new Headers(init?.headers),
    });
    if (opts.raw !== undefined) return new Response(opts.raw, { status: opts.status ?? 200 });
    return new Response(JSON.stringify(opts.body ?? imageFixture), { status: opts.status ?? 200 });
  }) as unknown as FetchFn;
}

const P_URL = new URL("https://www.instagram.com/p/CabcDEF123");
const GRAPHQL_URL = "https://www.instagram.com/graphql/query/";

describe("instagram adapter", () => {
  const a = createInstagramAdapter();

  test("match: exact hosts + post/reel/reels/tv path shapes only", () => {
    expect(a.match(P_URL)).toBe(true);
    expect(a.match(new URL("https://instagram.com/p/CabcDEF123"))).toBe(true);
    expect(a.match(new URL("https://www.instagram.com/reel/CabcDEF123"))).toBe(true);
    expect(a.match(new URL("https://www.instagram.com/reels/CabcDEF123"))).toBe(true);
    expect(a.match(new URL("https://www.instagram.com/tv/CabcDEF123"))).toBe(true);
    expect(a.match(new URL("https://ddinstagram.com/p/CabcDEF123"))).toBe(true);
    // profile-only / stories / no code
    expect(a.match(new URL("https://www.instagram.com/janedoe"))).toBe(false);
    expect(a.match(new URL("https://www.instagram.com/p/"))).toBe(false);
    expect(a.match(new URL("https://www.instagram.com/stories/janedoe/123"))).toBe(false);
    // wrong hosts (substring / subdomain must not match)
    expect(a.match(new URL("https://instagram.com.evil.com/p/CabcDEF123"))).toBe(false);
    expect(a.match(new URL("https://notinstagram.com/p/CabcDEF123"))).toBe(false);
    expect(a.match(new URL("https://foo.instagram.com/p/CabcDEF123"))).toBe(false);
  });

  test("canonicalize: reel/reels/tv normalized to /p/, query stripped", () => {
    expect(a.canonicalize(new URL("https://www.instagram.com/reel/CabcDEF123?igshid=x"))).toBe(
      "https://www.instagram.com/p/CabcDEF123",
    );
    expect(a.canonicalize(new URL("https://www.instagram.com/reels/CabcDEF123"))).toBe(
      "https://www.instagram.com/p/CabcDEF123",
    );
    expect(a.canonicalize(new URL("https://www.instagram.com/tv/CabcDEF123"))).toBe(
      "https://www.instagram.com/p/CabcDEF123",
    );
    expect(a.canonicalize(new URL("https://ddinstagram.com/p/CabcDEF123?x=1"))).toBe(
      "https://www.instagram.com/p/CabcDEF123",
    );
  });

  test("graphql request: endpoint, headers, and form body shape", async () => {
    const recorded: Recorded[] = [];
    const ad = createInstagramAdapter(fakeFetch({ recorded }));
    await ad.resolve(P_URL);
    expect(recorded).toHaveLength(1);
    const r = recorded[0]!;
    expect(r.url).toBe(GRAPHQL_URL);
    expect(r.headers.get("X-IG-App-ID")).toBe(INSTAGRAM_DEFAULTS.appId);
    expect(r.headers.get("X-FB-Friendly-Name")).toBe(INSTAGRAM_DEFAULTS.friendlyName);
    expect(r.headers.get("X-ASBD-ID")).toBe("129477");
    expect(r.headers.get("Origin")).toBe("https://www.instagram.com");
    expect(r.headers.get("User-Agent")).toBe(CHROME_UA);
    expect(r.body).toContain(`doc_id=${INSTAGRAM_DEFAULTS.docId}`);
    // variables carries the scraped shortcode (form-encoded JSON)
    expect(r.body).toContain(encodeURIComponent('{"shortcode":"CabcDEF123"}'));
  });

  test("image post: image kind, title, caption, dims, author, meta", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: imageFixture }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("image");
    expect(m.title).toBe("@janedoe");
    expect(m.description).toBe("Golden hour at the pier.");
    expect(m.image?.url).toBe("https://scontent.cdninstagram.com/ig_image_full.jpg?efg=sig");
    expect(m.image?.width).toBe(1080);
    expect(m.image?.height).toBe(1350);
    expect(m.author?.name).toBe("@janedoe");
    expect(m.author?.url).toBe("https://www.instagram.com/janedoe");
    expect(m.siteName).toBe("Instagram");
    expect(m.themeColor).toBe("#E1306C");
    expect(m.nsfw).toBe(false);
    expect(m.ttlSeconds).toBe(3600);
    expect(m.originalUrl).toBe("https://www.instagram.com/p/CabcDEF123");
  });

  test("video post: raw cdn url + proxyHeaders, dims, poster, ttl", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: videoFixture }));
    const m = await ad.resolve(new URL("https://www.instagram.com/reel/CabcDEF456"));
    expect(m.kind).toBe("video");
    // RAW cdn URL is emitted; proxy-wrapping is the app's job (T25).
    expect(m.video?.url).toBe("https://scontent.cdninstagram.com/ig_video_720.mp4?efg=sig&_nc_ht=x");
    expect(m.video?.url.startsWith("https://scontent.cdninstagram.com/")).toBe(true);
    expect(m.video?.mimeType).toBe("video/mp4");
    expect(m.video?.width).toBe(720);
    expect(m.video?.height).toBe(1280);
    expect(m.video?.proxyHeaders?.["User-Agent"]).toBe(CHROME_UA);
    expect(m.video?.proxyHeaders?.Referer).toBe("https://www.instagram.com/");
    expect(m.image?.url).toBe("https://scontent.cdninstagram.com/ig_video_poster.jpg?efg=sig");
    expect(m.ttlSeconds).toBe(3600);
    // reel canonicalizes to /p/ form
    expect(m.originalUrl).toBe("https://www.instagram.com/p/CabcDEF456");
  });

  test("modern XDT-prefixed typenames resolve like the legacy names", async () => {
    // The preferred xdt_shortcode_media node returns XDTGraphVideo/XDTGraphSidecar
    // in the wild; without prefix-normalization video would silently degrade to image.
    const xdtVideo = structuredClone(videoFixture) as {
      data: { xdt_shortcode_media: { __typename: string } };
    };
    xdtVideo.data.xdt_shortcode_media.__typename = "XDTGraphVideo";
    const ad = createInstagramAdapter(fakeFetch({ body: xdtVideo }));
    const m = await ad.resolve(new URL("https://www.instagram.com/reel/CabcDEF456"));
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://scontent.cdninstagram.com/ig_video_720.mp4?efg=sig&_nc_ht=x");

    const xdtSidecar = {
      data: {
        xdt_shortcode_media: {
          __typename: "XDTGraphSidecar",
          shortcode: "CabcDEF456",
          owner: { username: "johndoe" },
          edge_media_to_caption: { edges: [{ node: { text: "gallery" } }] },
          edge_sidecar_to_children: {
            edges: [
              { node: { __typename: "XDTGraphImage", display_url: "https://scontent.cdninstagram.com/s1.jpg" } },
              { node: { __typename: "XDTGraphImage", display_url: "https://scontent.cdninstagram.com/s2.jpg" } },
            ],
          },
        },
      },
    };
    const ad2 = createInstagramAdapter(fakeFetch({ body: xdtSidecar }));
    const m2 = await ad2.resolve(new URL("https://www.instagram.com/p/CabcDEF456"));
    expect(m2.kind).toBe("image");
    expect(m2.image?.url).toBe("https://scontent.cdninstagram.com/s1.jpg");
    expect(m2.description).toContain("📷 2");
  });

  test("login wall (status: fail) -> informative link embed, does NOT throw", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: { status: "fail" } }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
    expect(m.title).toBe("Instagram");
    expect(m.description).toBe("Instagram blocked this preview (login wall). Click through to view.");
    expect(m.siteName).toBe("Instagram");
    expect(m.nsfw).toBe(false);
    expect(m.originalUrl).toBe("https://www.instagram.com/p/CabcDEF123");
  });

  test("login wall (require_login) -> link embed", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: { require_login: true } }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
    expect(m.description).toContain("login wall");
  });

  test("non-JSON body (HTML login page) -> link embed, no throw", async () => {
    const ad = createInstagramAdapter(fakeFetch({ raw: "<!DOCTYPE html><html>login</html>" }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
    expect(m.description).toContain("login wall");
  });

  test("media absent (empty data) -> link embed", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: { data: {} } }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
  });

  test("transport error (thrown fetch) -> link embed, not a throw", async () => {
    const throwing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as FetchFn;
    const ad = createInstagramAdapter(throwing);
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
  });

  test("older alias data.shortcode_media is honored", async () => {
    const legacy = {
      data: {
        shortcode_media: {
          __typename: "GraphImage",
          display_url: "https://scontent.cdninstagram.com/legacy.jpg",
          dimensions: { width: 640, height: 640 },
          owner: { username: "legacyuser" },
          edge_media_to_caption: { edges: [{ node: { text: "old shape" } }] },
        },
      },
    };
    const ad = createInstagramAdapter(fakeFetch({ body: legacy }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("image");
    expect(m.title).toBe("@legacyuser");
    expect(m.image?.url).toBe("https://scontent.cdninstagram.com/legacy.jpg");
  });

  test("sidecar: first child media + count marker", async () => {
    const sidecar = {
      data: {
        xdt_shortcode_media: {
          __typename: "GraphSidecar",
          owner: { username: "carol" },
          edge_media_to_caption: { edges: [{ node: { text: "Trip dump" } }] },
          edge_sidecar_to_children: {
            edges: [
              {
                node: {
                  __typename: "GraphImage",
                  display_url: "https://scontent.cdninstagram.com/c1.jpg",
                  dimensions: { width: 1080, height: 1080 },
                },
              },
              { node: { __typename: "GraphImage", display_url: "https://scontent.cdninstagram.com/c2.jpg" } },
              { node: { __typename: "GraphImage", display_url: "https://scontent.cdninstagram.com/c3.jpg" } },
            ],
          },
        },
      },
    };
    const ad = createInstagramAdapter(fakeFetch({ body: sidecar }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("image");
    expect(m.image?.url).toBe("https://scontent.cdninstagram.com/c1.jpg");
    expect(m.image?.width).toBe(1080);
    expect(m.description).toBe("Trip dump 📷 3");
  });

  test("sidecar first child can be a video (proxyHeaders applied)", async () => {
    const sidecar = {
      data: {
        xdt_shortcode_media: {
          __typename: "GraphSidecar",
          owner: { username: "carol" },
          edge_sidecar_to_children: {
            edges: [
              {
                node: {
                  __typename: "GraphVideo",
                  video_url: "https://scontent.cdninstagram.com/child_video.mp4",
                  display_url: "https://scontent.cdninstagram.com/child_poster.jpg",
                  dimensions: { width: 720, height: 720 },
                },
              },
              { node: { __typename: "GraphImage", display_url: "https://scontent.cdninstagram.com/c2.jpg" } },
            ],
          },
        },
      },
    };
    const ad = createInstagramAdapter(fakeFetch({ body: sidecar }));
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://scontent.cdninstagram.com/child_video.mp4");
    expect(m.video?.proxyHeaders?.["User-Agent"]).toBe(CHROME_UA);
    expect(m.description).toBe("📷 2");
  });

  test("proxyUrl routing: request goes through the configured offload prefix", async () => {
    const recorded: Recorded[] = [];
    const proxyUrl = "https://proxy.example/fetch?u=";
    const ad = createInstagramAdapter(fakeFetch({ recorded }), {
      ...INSTAGRAM_DEFAULTS,
      proxyUrl,
    });
    await ad.resolve(P_URL);
    expect(recorded[0]!.url).toBe(proxyUrl + encodeURIComponent(GRAPHQL_URL));
  });

  test("session cookie is sent on the GraphQL call with mirrored X-CSRFToken", async () => {
    const recorded: Recorded[] = [];
    const ad = createInstagramAdapter(fakeFetch({ recorded, body: videoFixture }), {
      ...INSTAGRAM_DEFAULTS,
      cookie: "sessionid=SECRET_SESSION; csrftoken=TOKEN123; ds_user_id=42",
    });
    await ad.resolve(P_URL);
    expect(recorded[0]!.headers.get("Cookie")).toBe("sessionid=SECRET_SESSION; csrftoken=TOKEN123; ds_user_id=42");
    expect(recorded[0]!.headers.get("X-CSRFToken")).toBe("TOKEN123");
  });

  test("no Cookie header when no session cookie is configured", async () => {
    const recorded: Recorded[] = [];
    await createInstagramAdapter(fakeFetch({ recorded, body: videoFixture })).resolve(P_URL);
    expect(recorded[0]!.headers.get("Cookie")).toBeNull();
    expect(recorded[0]!.headers.get("X-CSRFToken")).toBeNull();
  });

  test("session cookie NEVER leaks into video.proxyHeaders (must not reach the /v/ token)", async () => {
    const ad = createInstagramAdapter(fakeFetch({ body: videoFixture }), {
      ...INSTAGRAM_DEFAULTS,
      cookie: "sessionid=SUPER_SECRET",
    });
    const m = await ad.resolve(P_URL);
    expect(m.video?.proxyHeaders).toBeDefined();
    const serialized = JSON.stringify(m.video?.proxyHeaders);
    expect(serialized).not.toContain("SUPER_SECRET");
    expect(serialized).not.toContain("sessionid");
    expect(m.video?.proxyHeaders?.Cookie).toBeUndefined();
  });

  test("snapsave fallback fires when our own fetch is login-walled (opt-in)", async () => {
    const blob = await Bun.file(
      new URL("./fixtures/instagram/snapsave-response.txt", import.meta.url),
    ).text();
    // graphql → login wall; snapsave.app → the recorded blob
    const fetchFn = (async (input: unknown) => {
      if (String(input).includes("snapsave")) return new Response(blob, { status: 200 });
      return new Response(JSON.stringify({ status: "fail", require_login: true }), { status: 200 });
    }) as unknown as FetchFn;
    const ad = createInstagramAdapter(fetchFn, { ...INSTAGRAM_DEFAULTS, snapsave: true });
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("image"); // recorded blob is a photo
    expect(m.image?.url).toContain("d.rapidcdn.app");
    expect(m.description ?? "").not.toContain("blocked"); // NOT the login-wall degrade
  });

  test("without the snapsave flag, a login wall still degrades to the informative card", async () => {
    const fetchFn = (async (input: unknown) => {
      if (String(input).includes("snapsave")) throw new Error("should not be called");
      return new Response(JSON.stringify({ status: "fail" }), { status: 200 });
    }) as unknown as FetchFn;
    const ad = createInstagramAdapter(fetchFn, { ...INSTAGRAM_DEFAULTS, snapsave: false });
    const m = await ad.resolve(P_URL);
    expect(m.kind).toBe("link");
    expect(m.description).toContain("blocked");
  });

  test("config is injectable (2nd param overrides defaults)", async () => {
    const recorded: Recorded[] = [];
    const ad = createInstagramAdapter(fakeFetch({ recorded }), {
      docId: "999",
      appId: "111",
      friendlyName: "CustomQuery",
    });
    await ad.resolve(P_URL);
    expect(recorded[0]!.body).toContain("doc_id=999");
    expect(recorded[0]!.headers.get("X-IG-App-ID")).toBe("111");
    expect(recorded[0]!.headers.get("X-FB-Friendly-Name")).toBe("CustomQuery");
  });
});
