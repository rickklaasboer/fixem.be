import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";
import { truncate } from "../lib/text";

const API = "https://public.api.bsky.app/xrpc";
const PATH_RE = /^\/profile\/([^/]+)\/post\/([^/]+)\/?$/;

interface BskyAuthor {
  handle: string;
  displayName?: string;
}

interface BskyThreadResponse {
  thread?: {
    $type?: string;
    post?: {
      author: BskyAuthor;
      record: { text?: string };
      embed?: {
        $type?: string;
        images?: { fullsize: string; aspectRatio?: { width: number; height: number } }[];
        playlist?: string;
        thumbnail?: string;
        external?: { uri: string; title?: string; thumb?: string };
        record?: { author?: BskyAuthor; value?: { text?: string } };
      };
    };
  };
}

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": "fixem.be/1.0 (embed fixer; +https://fixem.be)" },
  });
  if (!res.ok) throw new Error(`bluesky ${res.status}`);
  return (await res.json()) as T;
}

export function createBlueskyAdapter(fetchFn: FetchFn = fetch): PlatformAdapter {
  return {
    name: "bluesky",
    match(url) {
      return (
        (url.hostname === "bsky.app" || url.hostname === "www.bsky.app") &&
        PATH_RE.test(url.pathname)
      );
    },
    canonicalize(url) {
      const m = url.pathname.match(PATH_RE)!;
      return `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
    },
    async resolve(url): Promise<EmbedMetadata> {
      const m = url.pathname.match(PATH_RE);
      if (!m) throw new Error("bluesky: not a post URL");
      const [, actor, rkey] = m;

      let did = actor!;
      if (!did.startsWith("did:")) {
        const r = await getJson<{ did: string }>(
          fetchFn,
          `${API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor!)}`,
        );
        did = r.did;
      }

      const atUri = `at://${did}/app.bsky.feed.post/${rkey}`;
      const data = await getJson<BskyThreadResponse>(
        fetchFn,
        `${API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=0`,
      );
      const post = data.thread?.post;
      if (!post || !data.thread?.$type?.endsWith("#threadViewPost")) {
        throw new Error("bluesky: post unavailable");
      }

      const { handle, displayName } = post.author;
      const name = displayName?.trim() || handle;
      const text = (post.record.text ?? "").trim();
      const descParts: string[] = text ? [truncate(text, 300)] : [];

      let kind: EmbedMetadata["kind"] = "link";
      let image: EmbedMetadata["image"];
      let titlePrefix = "";

      const embed = post.embed;
      const embedType = embed?.$type ?? "";
      if (embedType.startsWith("app.bsky.embed.images")) {
        kind = "image";
        const first = embed?.images?.[0];
        if (first) {
          image = {
            url: first.fullsize,
            width: first.aspectRatio?.width,
            height: first.aspectRatio?.height,
          };
        }
        if ((embed?.images?.length ?? 0) > 1) descParts.push(`📷 ${embed!.images!.length} images`);
      } else if (embedType.startsWith("app.bsky.embed.video")) {
        // Bluesky video is HLS-only; Discord's player won't fetch .m3u8 via
        // og:video. Serve the thumbnail for M2; direct playback arrives with
        // the M4 video proxy (spec §12).
        kind = "video";
        titlePrefix = "▶ ";
        if (embed?.thumbnail) image = { url: embed.thumbnail };
      } else if (embedType.startsWith("app.bsky.embed.external")) {
        if (embed?.external?.thumb) image = { url: embed.external.thumb };
        if (embed?.external?.title) descParts.push(`🔗 ${embed.external.title}`);
      } else if (embedType.startsWith("app.bsky.embed.record")) {
        const quoted = embed?.record;
        if (quoted?.author?.handle) {
          const qText = (quoted.value?.text ?? "").trim();
          descParts.push(`↪ @${quoted.author.handle}: ${truncate(qText, 120)}`);
        }
      }

      return {
        kind,
        // Accounts without a display name title as just "@handle" — not the
        // duplicated "handle (@handle)".
        title:
          name === handle
            ? `${titlePrefix}@${handle}`
            : `${titlePrefix}${name} (@${handle})`,
        description: descParts.length ? descParts.join(" ") : undefined,
        author: { name, url: `https://bsky.app/profile/${handle}` },
        siteName: "Bluesky",
        themeColor: "#1185FE",
        image,
        nsfw: false,
        originalUrl: this.canonicalize(url),
      };
    },
  };
}
