import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";
import { CHROME_UA, withSignal } from "../lib/http";
import { fetchSnapsaveMedia } from "./snapsave";

const HOSTS = new Set(["instagram.com", "www.instagram.com", "ddinstagram.com"]);
// /(p|reel|reels|tv)/<code>. The <code> is base64-ish (starts C/D/B) — allow the
// url-safe alphabet only, and require it non-empty so a bare `/p/` never matches.
const PATH_RE = /^\/(?:p|tv|reels?)\/([A-Za-z0-9_-]+)\/?$/;

const GRAPHQL_URL = "https://www.instagram.com/graphql/query/";
// Bot-detection fingerprint sent on the anonymous web call (research §2b).
const ASBD_ID = "129477";
// cdninstagram media URLs are signed & short-lived — don't cache past ~1h, and
// only replay when re-fetched with these headers (Discord won't send them).
const MEDIA_TTL_SECONDS = 3600;
const MEDIA_PROXY_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Referer: "https://www.instagram.com/",
};

// Version-fragile pinned web-client constants. Meta rotates these a few times a
// year, so they're externalized: breakage becomes a config change, not a code
// change (mirrors threads.ts's THREADS_DEFAULTS). `proxyUrl` is an optional
// residential-proxy offload hook — see resolve().
export interface InstagramConfig {
  docId: string;
  appId: string;
  friendlyName: string;
  proxyUrl?: string;
  // Optional logged-in session cookie (a burner's `sessionid=...`, ideally with
  // `csrftoken`/`ds_user_id`). When set, the GraphQL call authenticates and walks
  // past the login wall. SECURITY: this is a full account credential — it is only
  // sent on the metadata request, is never logged, and never enters the /v/ proxy
  // token (media replays on its own signed URL). Burners get banned; expect churn.
  cookie?: string;
  // Opt-in last-resort fallback: when our own fetch is login-walled, resolve via
  // snapsave.app (third-party, fragile — see snapsave.ts). Off by default.
  snapsave?: boolean;
}

export const INSTAGRAM_DEFAULTS: InstagramConfig = {
  docId: "25531498899829322",
  appId: "936619743392459",
  friendlyName: "PolarisPostActionLoadPostQueryQuery",
};

// --- Authenticated mobile private-API (i.instagram.com) types + helpers ---
// With a session cookie, media/<id>/info is far more stable than the web GraphQL
// (which needs a doc_id Instagram rotates constantly). Preferred when a cookie is set.
const MOBILE_API = "https://i.instagram.com/api/v1/media";
const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Instagram shortcodes are base64url of the numeric media pk.
function shortcodeToMediaId(sc: string): string {
  let id = 0n;
  for (const c of sc) {
    const v = SHORTCODE_ALPHABET.indexOf(c);
    if (v < 0) return "";
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

interface MobileImage {
  url?: string;
  width?: number;
  height?: number;
}
interface MobileItem {
  media_type?: number; // 1=image, 2=video, 8=carousel
  user?: { username?: string };
  caption?: { text?: string } | null;
  original_width?: number;
  original_height?: number;
  image_versions2?: { candidates?: MobileImage[] };
  video_versions?: MobileImage[];
  carousel_media?: MobileItem[];
}

interface MediaNode {
  __typename?: string;
  display_url?: string;
  video_url?: string;
  dimensions?: { width?: number; height?: number };
}

interface ShortcodeMedia extends MediaNode {
  owner?: { username?: string };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_sidecar_to_children?: { edges?: { node?: MediaNode }[] };
}

interface GraphqlResponse {
  status?: string;
  require_login?: boolean;
  data?: { xdt_shortcode_media?: ShortcodeMedia | null; shortcode_media?: ShortcodeMedia | null };
}

function codeOf(url: URL): string | null {
  const m = url.pathname.match(PATH_RE);
  return m ? m[1]! : null;
}

// Map a single media node (the post itself or a sidecar child) to its kind and
// image/video fields. Shared so sidecar children also pick up video proxying.
// The modern `xdt_shortcode_media` node returns XDT-prefixed typenames
// (XDTGraphVideo/XDTGraphImage/XDTGraphSidecar); the legacy `shortcode_media`
// alias uses the bare names. Normalize so both resolve identically.
function baseTypename(t: string | undefined): string {
  return (t ?? "").replace(/^XDT/, "");
}

function pickMedia(node: MediaNode): Pick<EmbedMetadata, "kind" | "image" | "video"> {
  const width = node.dimensions?.width;
  const height = node.dimensions?.height;
  if (baseTypename(node.__typename) === "GraphVideo" && node.video_url) {
    return {
      kind: "video",
      video: {
        // RAW cdninstagram URL — the app wraps it in the signed /v/ proxy (T25).
        url: node.video_url,
        width,
        height,
        mimeType: "video/mp4",
        proxyHeaders: MEDIA_PROXY_HEADERS,
      },
      image: node.display_url ? { url: node.display_url } : undefined,
    };
  }
  if (node.display_url) {
    return { kind: "image", image: { url: node.display_url, width, height } };
  }
  return { kind: "link" };
}

// The degrade path is the MAIN path from a datacenter IP: Instagram routinely
// answers with a login wall. An honest, explanatory text embed beats a bare
// redirect, so this is the expected output — not a failure (research §2).
function loginWallEmbed(canonical: string): EmbedMetadata {
  return {
    kind: "link",
    title: "Instagram",
    description: "Instagram blocked this preview (login wall). Click through to view.",
    siteName: "Instagram",
    themeColor: "#E1306C",
    nsfw: false,
    ttlSeconds: 600,
    originalUrl: canonical,
  };
}

// Map one mobile item (post or carousel child) to kind + image/video.
function pickMobileMedia(item: MobileItem): Pick<EmbedMetadata, "kind" | "image" | "video"> {
  const w = item.original_width;
  const h = item.original_height;
  const video = item.video_versions?.[0];
  if (video?.url) {
    const poster = item.image_versions2?.candidates?.[0]?.url;
    return {
      kind: "video",
      video: {
        url: video.url,
        width: video.width ?? w,
        height: video.height ?? h,
        mimeType: "video/mp4",
        proxyHeaders: MEDIA_PROXY_HEADERS, // cookie NEVER goes here (not in /v/ token)
      },
      image: poster ? { url: poster } : undefined,
    };
  }
  const img = item.image_versions2?.candidates?.[0];
  if (img?.url) return { kind: "image", image: { url: img.url, width: img.width ?? w, height: img.height ?? h } };
  return { kind: "link" };
}

function metaFromMobile(item: MobileItem, canonical: string): EmbedMetadata {
  const username = item.user?.username ?? "instagram";
  const descParts: string[] = [];
  const caption = (item.caption?.text ?? "").trim();
  if (caption) descParts.push(truncate(caption, 300));
  let node = item;
  if (item.media_type === 8 && item.carousel_media && item.carousel_media.length > 0) {
    node = item.carousel_media[0]!;
    if (item.carousel_media.length > 1) descParts.push(`📷 ${item.carousel_media.length}`);
  }
  const picked = pickMobileMedia(node);
  const hasMedia = picked.kind === "video" || picked.kind === "image";
  return {
    kind: picked.kind,
    title: `@${username}`,
    description: descParts.length ? descParts.join(" ") : undefined,
    author: { name: `@${username}`, url: `https://www.instagram.com/${username}` },
    siteName: "Instagram",
    themeColor: "#E1306C",
    image: picked.image,
    video: picked.video,
    nsfw: false,
    ttlSeconds: hasMedia ? MEDIA_TTL_SECONDS : undefined,
    originalUrl: canonical,
  };
}

export function createInstagramAdapter(
  fetchFn: FetchFn = fetch,
  cfg: InstagramConfig = INSTAGRAM_DEFAULTS,
): PlatformAdapter {
  // Authenticated path: the mobile private API (needs a session cookie). Returns
  // null on any failure so resolve() can fall through to the other strategies.
  async function fetchMobileMedia(f: FetchFn, code: string): Promise<MobileItem | null> {
    if (!cfg.cookie) return null;
    const mediaId = shortcodeToMediaId(code);
    if (!mediaId) return null;
    try {
      const csrf = cfg.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "";
      const res = await f(`${MOBILE_API}/${mediaId}/info/`, {
        headers: {
          "User-Agent": "Instagram 269.0.0.18.75 Android",
          "X-IG-App-ID": cfg.appId,
          "X-CSRFToken": csrf,
          Cookie: cfg.cookie, // never logged; never enters the /v/ token
          Accept: "*/*",
        },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { items?: MobileItem[] };
      return j.items?.[0] ?? null;
    } catch {
      return null;
    }
  }

  // Fetch + parse the post payload. Returns null (→ degrade) for every
  // reachable-but-empty outcome — login wall (status:"fail" / require_login),
  // a non-JSON HTML wall, missing media, or a thrown/failed transport. We prefer
  // degrade-to-informative-link over throwing wherever Instagram is reachable.
  async function fetchMedia(f: FetchFn, code: string): Promise<ShortcodeMedia | null> {
    // proxyUrl offload hook: if set, route the request through it by prepending
    // the prefix + encoded target. A full residential-proxy client (auth, CONNECT
    // tunneling) is out of scope — this is the minimal wiring point.
    const requestUrl = cfg.proxyUrl ? cfg.proxyUrl + encodeURIComponent(GRAPHQL_URL) : GRAPHQL_URL;

    let text: string;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": CHROME_UA,
        Origin: "https://www.instagram.com",
        "X-IG-App-ID": cfg.appId,
        "X-FB-Friendly-Name": cfg.friendlyName,
        "X-ASBD-ID": ASBD_ID,
      };
      if (cfg.cookie) {
        // Authenticated read: send the session cookie, and mirror its csrftoken
        // into X-CSRFToken (Instagram requires the match on POST). Never logged.
        headers.Cookie = cfg.cookie;
        const csrf = cfg.cookie.match(/csrftoken=([^;]+)/)?.[1];
        if (csrf) headers["X-CSRFToken"] = csrf;
      }
      const res = await f(requestUrl, {
        method: "POST",
        headers,
        body: new URLSearchParams({
          doc_id: cfg.docId,
          variables: JSON.stringify({ shortcode: code }),
        }).toString(),
      });
      // Don't gate on res.ok: Instagram returns 200 with a `{"status":"fail"}`
      // body for login walls, so ok/!ok is ambiguous — inspect the body instead.
      text = await res.text();
    } catch {
      return null; // network/transport failure → degrade, not throw
    }

    let json: GraphqlResponse;
    try {
      json = JSON.parse(text) as GraphqlResponse;
    } catch {
      return null; // login wall serves HTML → non-JSON body
    }
    if (json.status === "fail" || json.require_login) return null;
    return json.data?.xdt_shortcode_media ?? json.data?.shortcode_media ?? null;
  }

  return {
    name: "instagram",
    match(url) {
      return HOSTS.has(url.hostname) && PATH_RE.test(url.pathname);
    },
    canonicalize(url) {
      const code = codeOf(url);
      // Reels/tv normalize to /p/ — the embed resolves either way, and a single
      // canonical form keeps the cache key stable across URL variants.
      return code ? `https://www.instagram.com/p/${code}` : url.href;
    },
    async resolve(url, signal): Promise<EmbedMetadata> {
      const f = withSignal(fetchFn, signal);
      const code = codeOf(url);
      if (!code) throw new Error("instagram: not a post URL");
      const canonical = `https://www.instagram.com/p/${code}`;

      // Preferred authenticated path: the mobile private API (stable, no doc_id).
      if (cfg.cookie) {
        const mobile = await fetchMobileMedia(f, code);
        if (mobile) return metaFromMobile(mobile, canonical);
      }

      const media = await fetchMedia(f, code);
      if (!media) {
        // Login-walled → optional snapsave.app fallback (third-party) before the
        // informative degrade. rapidcdn media links are Discord-fetchable directly,
        // so no /v/ proxy and no proxyHeaders.
        if (cfg.snapsave) {
          const snap = await fetchSnapsaveMedia(canonical, f);
          if (snap) {
            return {
              kind: snap.kind,
              title: "Instagram",
              description: snap.count > 1 ? `📷 ${snap.count} items` : undefined,
              siteName: "Instagram",
              themeColor: "#E1306C",
              image:
                snap.kind === "video"
                  ? snap.thumbnailUrl
                    ? { url: snap.thumbnailUrl }
                    : undefined
                  : { url: snap.mediaUrl },
              video: snap.kind === "video" ? { url: snap.mediaUrl, mimeType: "video/mp4" } : undefined,
              nsfw: false,
              ttlSeconds: 1800, // rapidcdn JWT links are short-lived
              originalUrl: canonical,
            };
          }
        }
        return loginWallEmbed(canonical);
      }

      const username = media.owner?.username ?? "instagram";
      const descParts: string[] = [];
      const caption = (media.edge_media_to_caption?.edges?.[0]?.node?.text ?? "").trim();
      if (caption) descParts.push(truncate(caption, 300));

      // A sidecar (gallery) renders its first child; mark the count so the
      // "N items" hint isn't lost.
      let node: MediaNode = media;
      const children = media.edge_sidecar_to_children?.edges;
      if (baseTypename(media.__typename) === "GraphSidecar" && children && children.length > 0) {
        node = children[0]!.node ?? media;
        if (children.length > 1) descParts.push(`📷 ${children.length}`);
      }

      const picked = pickMedia(node);
      const hasMedia = picked.kind === "video" || picked.kind === "image";
      return {
        kind: picked.kind,
        title: `@${username}`,
        description: descParts.length ? descParts.join(" ") : undefined,
        author: { name: `@${username}`, url: `https://www.instagram.com/${username}` },
        siteName: "Instagram",
        themeColor: "#E1306C",
        image: picked.image,
        video: picked.video,
        nsfw: false,
        ttlSeconds: hasMedia ? MEDIA_TTL_SECONDS : undefined,
        originalUrl: canonical,
      };
    },
  };
}
