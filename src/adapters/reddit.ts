import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";
import { PLATFORM_UA, CHROME_UA, withSignal } from "../lib/http";

const HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "sh.reddit.com",
  "redd.it",
]);

// Mobile share links (/r/<sub>/s/<token>) redirect to the real permalink.
const SHARE_RE = /^\/r\/[^/]+\/s\/[^/]+\/?$/;

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
// Refresh when the cached token is within this margin of expiry.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface RedditCreds {
  clientId: string;
  clientSecret: string;
}

// App-only (client_credentials) token manager. State lives in the closure, so
// each adapter instance caches its own token.
function createTokenManager(
  fetchFn: FetchFn,
  creds: RedditCreds,
): (signal?: AbortSignal) => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  return async (signal) => {
    if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
    const res = await withSignal(fetchFn, signal)(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PLATFORM_UA,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`reddit: token request failed (${res.status})`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("reddit: token response missing access_token");
    cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000 };
    return cached.token;
  };
}

interface RedditPost {
  title: string;
  author: string;
  subreddit: string;
  over_18?: boolean;
  selftext?: string;
  post_hint?: string;
  url_overridden_by_dest?: string;
  is_gallery?: boolean;
  gallery_data?: { items: { media_id: string }[] };
  media_metadata?: Record<string, { s?: { u?: string; x?: number; y?: number } }>;
  secure_media?: { reddit_video?: { fallback_url?: string; width?: number; height?: number } };
  preview?: { images?: { source?: { url?: string; width?: number; height?: number } }[] };
  crosspost_parent_list?: RedditPost[];
}

function previewImage(post: RedditPost): EmbedMetadata["image"] {
  const src = post.preview?.images?.[0]?.source;
  return src?.url ? { url: src.url, width: src.width, height: src.height } : undefined;
}

function pickMedia(post: RedditPost): Pick<EmbedMetadata, "kind" | "image" | "video"> & { galleryCount?: number } {
  const video = post.secure_media?.reddit_video;
  if (video?.fallback_url) {
    return {
      kind: "video",
      video: { url: video.fallback_url, width: video.width, height: video.height, mimeType: "video/mp4" },
      image: previewImage(post),
    };
  }
  if (post.is_gallery && post.gallery_data && post.media_metadata) {
    const first = post.gallery_data.items[0];
    const s = first ? post.media_metadata[first.media_id]?.s : undefined;
    return {
      kind: "gallery",
      image: s?.u ? { url: s.u, width: s.x, height: s.y } : undefined,
      galleryCount: post.gallery_data.items.length,
    };
  }
  if (post.post_hint === "image" && post.url_overridden_by_dest) {
    const src = post.preview?.images?.[0]?.source;
    return {
      kind: "image",
      image: { url: post.url_overridden_by_dest, width: src?.width, height: src?.height },
    };
  }
  return { kind: "link", image: previewImage(post) };
}

// Build embed metadata from a parsed Reddit API post (the OAuth JSON path).
function metaFromPost(post: RedditPost, canonical: string): EmbedMetadata {
  // Crossposts: real video crossposts often carry a regenerated preview image
  // on the child while the actual media lives in the parent — inherit whenever
  // the parent has richer media, keeping the child's preview as poster fallback.
  const parent = post.crosspost_parent_list?.[0];
  let media = pickMedia(post);
  if (media.kind === "link" && parent) {
    const parentMedia = pickMedia(parent);
    if (parentMedia.kind !== "link") {
      media = { ...parentMedia, image: parentMedia.image ?? media.image };
    }
  }

  const selftext = (post.selftext ?? "").trim();
  const descParts: string[] = [];
  if (media.galleryCount) {
    const n = media.galleryCount;
    descParts.push(`Gallery • ${n} image${n === 1 ? "" : "s"}`);
  }
  if (selftext) descParts.push(truncate(selftext, 300));
  const description = descParts.length ? descParts.join(" — ") : undefined;

  return {
    kind: media.kind,
    title: post.title,
    description,
    author: { name: `u/${post.author}`, url: `https://www.reddit.com/user/${post.author}` },
    siteName: `Reddit • r/${post.subreddit}`,
    themeColor: "#FF4500",
    image: media.image,
    video: media.video,
    nsfw: post.over_18 ?? false,
    originalUrl: canonical,
  };
}

function decodeEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replace(/&#0*39;|&#x27;/gi, "'");
}

function metaContent(html: string, property: string): string | undefined {
  const m = html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`));
  return m ? decodeEntities(m[1]!) : undefined;
}

// Anonymous fallback: Reddit disabled the public `.json` API (returns 403 + the
// web-app shell) regardless of IP/UA, and OAuth credentials are now approval-
// gated. old.reddit.com still server-renders logged-out post HTML, so we scrape
// its stable og: tags + data- attributes. Video posts yield a poster image only
// — the muxed MP4 needs the OAuth JSON path; here they degrade to image.
function parseOldRedditHtml(html: string, canonical: string): EmbedMetadata {
  const thing = html.match(/<div [^>]*data-fullname="t3_[^>]*>/)?.[0] ?? "";
  const dataAttr = (name: string): string | undefined =>
    thing.match(new RegExp(`${name}="([^"]*)"`))?.[1];

  const author = dataAttr("data-author") || "[unknown]";
  const subreddit = dataAttr("data-subreddit") || "reddit";
  const nsfw = dataAttr("data-nsfw") === "true";
  const domain = dataAttr("data-domain") ?? "";
  const isGallery = dataAttr("data-is-gallery") === "true";
  const image = metaContent(html, "og:image");
  const title = metaContent(html, "og:title") ?? `Post from r/${subreddit}`;

  let kind: EmbedMetadata["kind"] = "link";
  if (isGallery) kind = "gallery";
  else if (domain === "i.redd.it" || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(dataAttr("data-url") ?? "")) {
    kind = "image";
  } else if (image) kind = "image"; // link/video posts still carry a preview thumbnail

  return {
    kind,
    title,
    author: { name: `u/${author}`, url: `https://www.reddit.com/user/${author}` },
    siteName: `Reddit • r/${subreddit}`,
    themeColor: "#FF4500",
    image: image ? { url: image } : undefined,
    nsfw,
    originalUrl: canonical,
  };
}

export function createRedditAdapter(fetchFn: FetchFn = fetch, creds?: RedditCreds): PlatformAdapter {
  const getToken = creds ? createTokenManager(fetchFn, creds) : undefined;
  return {
    name: "reddit",
    match(url) {
      return HOSTS.has(url.hostname);
    },
    canonicalize(url) {
      if (url.hostname === "redd.it") {
        return `https://www.reddit.com/comments/${url.pathname.replace(/^\/|\/$/g, "")}`;
      }
      // Stays sync/net-free by design: share links cache under their share-URL canonical.
      return `https://www.reddit.com${url.pathname.replace(/\/$/, "")}`;
    },
    async resolve(url, signal): Promise<EmbedMetadata> {
      const f = withSignal(fetchFn, signal);
      let canonical = this.canonicalize(url);
      if (SHARE_RE.test(url.pathname)) {
        // The .json endpoint 307s share links to a non-JSON target, so follow
        // the redirect manually and resolve the real permalink instead. Send
        // the bearer when configured — the anonymous probe is IP-blocked on the
        // same networks OAuth exists for, so share links would otherwise never
        // resolve with credentials set.
        const shareHeaders: Record<string, string> = { "User-Agent": PLATFORM_UA };
        if (getToken) shareHeaders.Authorization = `bearer ${await getToken(signal)}`;
        const redirect = await f(canonical, {
          headers: shareHeaders,
          redirect: "manual",
        });
        let target: URL;
        try {
          target = new URL(redirect.headers.get("Location") ?? "");
        } catch {
          throw new Error("reddit: share link did not redirect");
        }
        canonical = `https://www.reddit.com${target.pathname.replace(/\/$/, "")}`;
      }

      // No credentials → scrape old.reddit's server-rendered HTML. Reddit's
      // anonymous `.json` API is globally disabled (403 + web-app shell), and
      // OAuth creds are approval-gated, so this is the working no-auth path.
      if (!getToken) {
        const htmlRes = await f(`https://old.reddit.com${new URL(canonical).pathname}`, {
          headers: { "User-Agent": CHROME_UA, Accept: "text/html" },
        });
        if (!htmlRes.ok) throw new Error(`reddit ${htmlRes.status}`);
        return parseOldRedditHtml(await htmlRes.text(), canonical);
      }

      // With credentials, hit oauth.reddit.com for the full JSON (richest —
      // includes muxed video, galleries, crosspost media). Canonical stays www.
      const res = await f(`https://oauth.reddit.com${new URL(canonical).pathname}.json?raw_json=1`, {
        headers: { Authorization: `bearer ${await getToken(signal)}`, "User-Agent": PLATFORM_UA },
      });
      if (!res.ok) throw new Error(`reddit ${res.status}`);
      const json = (await res.json()) as [{ data: { children: { data: RedditPost }[] } }, unknown];
      const post = json[0]?.data?.children?.[0]?.data;
      if (!post) throw new Error("reddit: no post in response");
      return metaFromPost(post, canonical);
    },
  };
}
