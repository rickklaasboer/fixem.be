import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";

const HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "redd.it"]);

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

export function createRedditAdapter(fetchFn: FetchFn = fetch): PlatformAdapter {
  return {
    name: "reddit",
    match(url) {
      return HOSTS.has(url.hostname);
    },
    canonicalize(url) {
      if (url.hostname === "redd.it") {
        return `https://www.reddit.com/comments/${url.pathname.replace(/^\/|\/$/g, "")}`;
      }
      return `https://www.reddit.com${url.pathname.replace(/\/$/, "")}`;
    },
    async resolve(url): Promise<EmbedMetadata> {
      const canonical = this.canonicalize(url);
      const res = await fetchFn(`${canonical}.json?raw_json=1`, {
        headers: { "User-Agent": "fixem.be/1.0 (embed fixer; +https://fixem.be)" },
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
      if (media.galleryCount) descParts.push(`Gallery • ${media.galleryCount} images`);
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
