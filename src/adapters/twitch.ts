import type { EmbedMetadata, FetchFn, PlatformAdapter } from "./types";

const HOSTS = new Set(["clips.twitch.tv", "twitch.tv", "www.twitch.tv", "m.twitch.tv"]);
const SLUG_RE = /^[A-Za-z0-9_-]+$/;
const CHANNEL_CLIP_RE = /^\/[^/]+\/clip\/([A-Za-z0-9_-]+)\/?$/;
const UA = "fixem.be/1.0 (embed fixer; +https://fixem.be)";

export interface TwitchGqlConfig {
  clientId: string;
  clipTokenHash: string;
}

// Public web client constants (research §1c) — env-overridable via config.
export const TWITCH_GQL_DEFAULTS: TwitchGqlConfig = {
  clientId: "kimne78kx3ncx6brgo4mv6wki5h1ko",
  clipTokenHash: "36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11",
};

interface HelixClip {
  title: string;
  broadcaster_name: string;
  view_count?: number;
  thumbnail_url?: string;
}

function slugFrom(url: URL): string | null {
  if (url.hostname === "clips.twitch.tv") {
    const s = url.pathname.split("/")[1] ?? "";
    return SLUG_RE.test(s) ? s : null;
  }
  const m = url.pathname.match(CHANNEL_CLIP_RE);
  return m ? m[1]! : null;
}

export function createTwitchAdapter(
  creds: { clientId: string; clientSecret: string },
  fetchFn: FetchFn = fetch,
  gql: TwitchGqlConfig = TWITCH_GQL_DEFAULTS,
): PlatformAdapter {
  let token: { value: string; expiresAt: number } | null = null;

  async function appToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;
    const res = await fetchFn("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: `client_id=${creds.clientId}&client_secret=${creds.clientSecret}&grant_type=client_credentials`,
    });
    if (!res.ok) throw new Error(`twitch token ${res.status}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("twitch token: no access_token");
    token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function helixClip(slug: string, retried = false): Promise<HelixClip> {
    const res = await fetchFn(`https://api.twitch.tv/helix/clips?id=${encodeURIComponent(slug)}`, {
      headers: {
        Authorization: `Bearer ${await appToken()}`,
        "Client-Id": creds.clientId,
        "User-Agent": UA,
      },
    });
    if (res.status === 401 && !retried) {
      token = null; // app tokens have no refresh flow — re-mint and retry once
      return helixClip(slug, true);
    }
    if (!res.ok) throw new Error(`twitch helix ${res.status}`);
    const j = (await res.json()) as { data?: HelixClip[] };
    const clip = j.data?.[0];
    if (!clip) throw new Error("twitch: clip not found");
    return clip;
  }

  // Best-effort: a clip embed without inline video is still useful, so GQL
  // failures return undefined instead of failing the whole resolve.
  async function clipMp4(slug: string): Promise<EmbedMetadata["video"]> {
    try {
      const res = await fetchFn("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: { "Client-ID": gql.clientId, "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({
          operationName: "VideoAccessToken_Clip",
          variables: { slug },
          extensions: { persistedQuery: { version: 1, sha256Hash: gql.clipTokenHash } },
        }),
      });
      if (!res.ok) return undefined;
      const j = (await res.json()) as {
        data?: {
          clip?: {
            playbackAccessToken?: { value: string; signature: string };
            videoQualities?: { quality: string; sourceURL: string }[];
          } | null;
        };
      };
      const clip = j.data?.clip;
      const access = clip?.playbackAccessToken;
      const best = clip?.videoQualities
        ?.slice()
        .sort((a, b) => Number(b.quality) - Number(a.quality))[0];
      if (!access || !best?.sourceURL) return undefined;
      const height = Number(best.quality) || undefined;
      return {
        url: `${best.sourceURL}?sig=${access.signature}&token=${encodeURIComponent(access.value)}`,
        width: height ? Math.round((height * 16) / 9) : undefined,
        height,
        mimeType: "video/mp4",
      };
    } catch {
      return undefined;
    }
  }

  return {
    name: "twitch",
    match(url) {
      return HOSTS.has(url.hostname) && slugFrom(url) !== null;
    },
    canonicalize(url) {
      return `https://clips.twitch.tv/${slugFrom(url)}`;
    },
    async resolve(url): Promise<EmbedMetadata> {
      const slug = slugFrom(url);
      if (!slug) throw new Error("twitch: no clip slug");
      const [clip, video] = await Promise.all([helixClip(slug), clipMp4(slug)]);
      return {
        kind: video ? "video" : "image",
        title: clip.title,
        description: clip.view_count !== undefined ? `${clip.view_count} views` : undefined,
        author: {
          name: clip.broadcaster_name,
          url: `https://www.twitch.tv/${clip.broadcaster_name}`,
        },
        siteName: "Twitch",
        themeColor: "#9146FF",
        image: clip.thumbnail_url ? { url: clip.thumbnail_url } : undefined,
        video,
        nsfw: false,
        // Signed MP4 URLs are short-lived — don't cache past their validity.
        ttlSeconds: 1800,
        originalUrl: `https://clips.twitch.tv/${slug}`,
      };
    },
  };
}
