import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";

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

const USER_AGENT = "fixem.be/1.0 (embed fixer; +https://fixem.be)";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
// Refresh when the cached token is within this margin of expiry.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface RedditCreds {
  clientId: string;
  clientSecret: string;
}

// App-only (client_credentials) token manager. State lives in the closure, so
// each adapter instance caches its own token.
function createTokenManager(fetchFn: FetchFn, creds: RedditCreds): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
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
    async resolve(url): Promise<EmbedMetadata> {
      let canonical = this.canonicalize(url);
      if (SHARE_RE.test(url.pathname)) {
        // The .json endpoint 307s share links to a non-JSON target, so follow
        // the redirect manually and resolve the real permalink instead.
        const redirect = await fetchFn(canonical, {
          headers: { "User-Agent": USER_AGENT },
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
      // With credentials, hit oauth.reddit.com — anonymous www.reddit.com JSON
      // is IP-blocked on many networks. Canonical URLs stay www.reddit.com.
      const res = getToken
        ? await fetchFn(`https://oauth.reddit.com${new URL(canonical).pathname}.json?raw_json=1`, {
            headers: { Authorization: `bearer ${await getToken()}`, "User-Agent": USER_AGENT },
          })
        : await fetchFn(`${canonical}.json?raw_json=1`, {
            headers: { "User-Agent": USER_AGENT },
          });
      if (!res.ok) throw new Error(`reddit ${res.status}`);
      const json = (await res.json()) as [{ data: { children: { data: RedditPost }[] } }, unknown];
      const post = json[0]?.data?.children?.[0]?.data;
      if (!post) throw new Error("reddit: no post in response");

      // Crossposts: real video crossposts often carry a regenerated preview
      // image on the child while the actual media lives in the parent —
      // inherit whenever the parent has richer media, keeping the child's
      // preview as poster fallback.
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
    },
  };
}
