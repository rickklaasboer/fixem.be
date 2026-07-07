import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";
import { FIREFOX_UA } from "../lib/http";

const HOSTS = new Set(["threads.net", "www.threads.net", "threads.com", "www.threads.com"]);
const POST_RE = /^\/@([^/]+)\/post\/([^/]+)\/?$/;
const SHORT_RE = /^\/t\/([^/]+)\/?$/;

const ROUTE_URL = "https://www.threads.net/ajax/bulk-route-definitions/";
const GRAPHQL_URL = "https://www.threads.net/api/graphql";
// Bot-detection fingerprint sent on both anonymous calls (research §1a).
const ASBD_ID = "129477";
// cdninstagram media URLs are signed & short-lived — don't cache past ~1h, and
// only replay when re-fetched with these headers (Discord won't send them).
const MEDIA_TTL_SECONDS = 3600;
const MEDIA_PROXY_HEADERS: Record<string, string> = {
  "User-Agent": FIREFOX_UA,
  Referer: "https://www.threads.com/",
};

// Version-fragile pinned web-client constants. Meta rotates these a few times a
// year, so they're externalized: breakage becomes a config change, not a code
// change (matches how twitch.ts exports TWITCH_GQL_DEFAULTS).
export interface ThreadsConfig {
  lsd: string;
  docId: string;
  appId: string;
  friendlyName: string;
}

export const THREADS_DEFAULTS: ThreadsConfig = {
  lsd: "XudMkvWGqcnLxbgeR25f3V",
  docId: "6821609764538244",
  appId: "238260118697367",
  friendlyName: "BarcelonaPostPageQuery",
};

interface ThreadsMediaNode {
  video_versions?: { url?: string }[];
  image_versions2?: { candidates?: { url?: string; width?: number; height?: number }[] };
  original_width?: number;
  original_height?: number;
}

interface ThreadsPost extends ThreadsMediaNode {
  user?: { username?: string; profile_pic_url?: string };
  caption?: { text?: string };
  carousel_media?: ThreadsMediaNode[];
}

interface GraphqlResponse {
  data?: { data?: { containing_thread?: { thread_items?: { post?: ThreadsPost }[] } } };
}

interface RootView {
  exports?: { rootView?: { props?: { post_id?: string } } };
}
interface RouteResponse {
  payload?: {
    payloads?: Record<string, { result?: RootView & { redirect_result?: RootView } }>;
  };
}

type Parsed =
  | { form: "post"; user: string; code: string }
  | { form: "short"; code: string };

function parsePath(url: URL): Parsed | null {
  const post = url.pathname.match(POST_RE);
  if (post) return { form: "post", user: post[1]!, code: post[2]! };
  const short = url.pathname.match(SHORT_RE);
  if (short) return { form: "short", code: short[1]! };
  return null;
}

function canonicalFor(p: Parsed): string {
  return p.form === "post"
    ? `https://www.threads.com/@${p.user}/post/${p.code}`
    : `https://www.threads.com/t/${p.code}`;
}

// Map a single media node (the post itself or a carousel child) to its kind and
// image/video fields. Shared so carousel children also pick up video proxying.
function pickMedia(node: ThreadsMediaNode): Pick<EmbedMetadata, "kind" | "image" | "video"> {
  const width = node.original_width ?? 640;
  const height = node.original_height ?? 640;
  const poster = node.image_versions2?.candidates?.[0];

  const videoUrl = node.video_versions?.[0]?.url;
  if (videoUrl) {
    return {
      kind: "video",
      video: {
        url: videoUrl,
        width,
        height,
        mimeType: "video/mp4",
        proxyHeaders: MEDIA_PROXY_HEADERS,
      },
      image: poster?.url ? { url: poster.url, width: poster.width, height: poster.height } : undefined,
    };
  }
  if (poster?.url) {
    return {
      kind: "image",
      image: { url: poster.url, width: poster.width ?? width, height: poster.height ?? height },
    };
  }
  return { kind: "link" };
}

export function createThreadsAdapter(
  fetchFn: FetchFn = fetch,
  cfg: ThreadsConfig = THREADS_DEFAULTS,
): PlatformAdapter {
  // Step 1: resolve the URL path to the numeric post id via bulk-route.
  async function resolvePostId(pathname: string): Promise<string> {
    const res = await fetchFn(ROUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": FIREFOX_UA,
        "X-FB-LSD": cfg.lsd,
        "X-ASBD-ID": ASBD_ID,
        "Sec-Fetch-Site": "same-origin",
      },
      // Built as a raw string to match Meta's documented wire format byte-for-
      // byte: URLSearchParams would percent-encode the `route_urls[0]` key.
      body:
        `route_urls[0]=${encodeURIComponent(pathname)}` +
        `&__a=1&__comet_req=29&lsd=${encodeURIComponent(cfg.lsd)}`,
    });
    if (!res.ok) throw new Error(`threads route ${res.status}`);
    const text = await res.text();
    // Response is prefixed with the `for (;;);` XSS guard — strip it before JSON.
    const body = text.startsWith("for (;;);") ? text.slice(9) : text;
    const json = JSON.parse(body) as RouteResponse;
    const result = json.payload?.payloads?.[pathname]?.result;
    const postId =
      result?.exports?.rootView?.props?.post_id ??
      result?.redirect_result?.exports?.rootView?.props?.post_id;
    if (!postId) throw new Error("threads: post_id not found in route definitions");
    return postId;
  }

  // Step 2: fetch the post payload via GraphQL.
  async function fetchPost(postId: string): Promise<ThreadsPost | undefined> {
    const res = await fetchFn(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": FIREFOX_UA,
        "X-FB-Friendly-Name": cfg.friendlyName,
        "X-IG-App-ID": cfg.appId,
        "X-FB-LSD": cfg.lsd,
        "X-ASBD-ID": ASBD_ID,
      },
      body: new URLSearchParams({
        lsd: cfg.lsd,
        variables: JSON.stringify({ postID: postId }),
        doc_id: cfg.docId,
      }).toString(),
    });
    if (!res.ok) throw new Error(`threads graphql ${res.status}`);
    const json = (await res.json()) as GraphqlResponse;
    const items = json.data?.data?.containing_thread?.thread_items ?? [];
    // Take the last item that actually carries a post (replies/tombstones drop in).
    for (let i = items.length - 1; i >= 0; i--) {
      const post = items[i]?.post;
      if (post) return post;
    }
    return undefined;
  }

  return {
    name: "threads",
    match(url) {
      return HOSTS.has(url.hostname) && parsePath(url) !== null;
    },
    canonicalize(url) {
      const p = parsePath(url);
      return p ? canonicalFor(p) : url.href;
    },
    async resolve(url): Promise<EmbedMetadata> {
      const p = parsePath(url);
      if (!p) throw new Error("threads: not a post URL");
      const canonical = canonicalFor(p);
      const pathUser = p.form === "post" ? p.user : undefined;

      const postId = await resolvePostId(url.pathname);
      const post = await fetchPost(postId);

      if (!post) {
        // Reachable but no data (private/deleted/blocked): an honest text embed
        // beats a bare redirect — mirrors twitter.ts's tombstone degrade.
        return {
          kind: "link",
          title: pathUser ? `@${pathUser}` : "Threads",
          description: "This Threads post couldn't be loaded (private, deleted, or blocked).",
          siteName: "Threads",
          themeColor: "#000000",
          nsfw: false,
          ttlSeconds: 600,
          originalUrl: canonical,
        };
      }

      const username = post.user?.username ?? pathUser ?? "threads";
      const descParts: string[] = [];
      const captionText = (post.caption?.text ?? "").trim();
      if (captionText) descParts.push(truncate(captionText, 300));

      let media = pickMedia(post);
      const carousel = post.carousel_media;
      // A carousel is the gallery signal regardless of any top-level cover: use
      // the first child for media when the post itself exposes none, and always
      // mark the count so the "N images" hint isn't dropped when a cover exists.
      if (carousel && carousel.length > 0) {
        if (media.kind === "link") media = pickMedia(carousel[0]!);
        if (carousel.length > 1) descParts.push(`📷 ${carousel.length}`);
      }

      const hasMedia = media.kind === "video" || media.kind === "image";
      return {
        kind: media.kind,
        title: `${username} on Threads`,
        description: descParts.length ? descParts.join(" ") : undefined,
        author: { name: `@${username}`, url: `https://www.threads.com/@${username}` },
        siteName: "Threads",
        themeColor: "#000000",
        image: media.image,
        video: media.video,
        nsfw: false,
        ttlSeconds: hasMedia ? MEDIA_TTL_SECONDS : undefined,
        originalUrl: canonical,
      };
    },
  };
}
