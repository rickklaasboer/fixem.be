import {injectable} from 'tsyringe';
import BaseAdapter from '@/adapters/BaseAdapter';
import Config from '@/config/Config';
import HttpClient from '@/services/HttpClient';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const HOSTS = new Set([
    'clips.twitch.tv',
    'twitch.tv',
    'www.twitch.tv',
    'm.twitch.tv',
]);
const SLUG_RE = /^[A-Za-z0-9_-]+$/;
const CLIPS_HOST_RE = /^\/([A-Za-z0-9_-]+)\/?$/;
const CHANNEL_CLIP_RE = /^\/[^/]+\/clip\/([A-Za-z0-9_-]+)\/?$/;

interface HelixClip {
    title: string;
    broadcaster_name: string;
    view_count?: number;
    thumbnail_url?: string;
}

function slugFrom(url: URL): string | null {
    if (url.hostname === 'clips.twitch.tv') {
        // The iframe/share form is /embed?clip=<slug>; read the slug from the query.
        if (url.pathname === '/embed' || url.pathname === '/embed/') {
            const clip = url.searchParams.get('clip');
            return clip && SLUG_RE.test(clip) ? clip : null;
        }
        // Otherwise exactly /<slug> — reject multi-segment paths that would
        // false-match and then fail Helix (counting against the circuit breaker).
        const m = url.pathname.match(CLIPS_HOST_RE);
        return m ? m[1]! : null;
    }
    const m = url.pathname.match(CHANNEL_CLIP_RE);
    return m ? m[1]! : null;
}

/**
 * Twitch clip embeds via Helix OAuth metadata plus the public GQL endpoint
 * for the signed clip MP4.
 */
@injectable()
export default class TwitchAdapter extends BaseAdapter {
    public name = 'twitch';

    private token: {value: string; expiresAt: number} | null = null;

    constructor(
        private config: Config,
        private http: HttpClient,
    ) {
        super();
    }

    public match(url: URL): boolean {
        return HOSTS.has(url.hostname) && slugFrom(url) !== null;
    }

    public canonicalize(url: URL): string {
        return `https://clips.twitch.tv/${slugFrom(url)}`;
    }

    /**
     * Resolve a Twitch clip into embed metadata.
     */
    public async resolve(
        url: URL,
        signal?: AbortSignal,
    ): Promise<EmbedMetadata> {
        const slug = slugFrom(url);
        if (!slug) throw new Error('twitch: no clip slug');
        const [clip, video] = await Promise.all([
            this.helixClip(slug, signal),
            this.clipMp4(slug, signal),
        ]);
        return {
            kind: video ? 'video' : 'image',
            title: clip.title,
            description:
                clip.view_count !== undefined
                    ? `${clip.view_count} views`
                    : undefined,
            author: {
                name: clip.broadcaster_name,
                url: `https://www.twitch.tv/${encodeURIComponent(clip.broadcaster_name)}`,
            },
            siteName: 'Twitch',
            themeColor: '#9146FF',
            image: clip.thumbnail_url ? {url: clip.thumbnail_url} : undefined,
            video,
            nsfw: false,
            // Signed MP4 URLs are short-lived — don't cache past their validity.
            ttlSeconds: 1800,
            originalUrl: `https://clips.twitch.tv/${slug}`,
        };
    }

    /**
     * Mint (or reuse a cached) Twitch app-access OAuth token.
     */
    private async appToken(signal?: AbortSignal): Promise<string> {
        if (this.token && Date.now() < this.token.expiresAt - 60_000)
            return this.token.value;
        const res = await this.http.fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.config.twitchClientId ?? '',
                client_secret: this.config.twitchClientSecret ?? '',
                grant_type: 'client_credentials',
            }).toString(),
            signal,
        });
        if (!res.ok) throw new Error(`twitch token ${res.status}`);
        const j = (await res.json()) as {
            access_token?: string;
            expires_in?: number;
        };
        if (!j.access_token) throw new Error('twitch token: no access_token');
        this.token = {
            value: j.access_token,
            expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
        };
        return this.token.value;
    }

    private async helixClip(
        slug: string,
        signal?: AbortSignal,
        retried = false,
    ): Promise<HelixClip> {
        const res = await this.http.fetch(
            `https://api.twitch.tv/helix/clips?id=${encodeURIComponent(slug)}`,
            {
                headers: {
                    Authorization: `Bearer ${await this.appToken(signal)}`,
                    'Client-Id': this.config.twitchClientId ?? '',
                },
                signal,
            },
        );
        if (res.status === 401 && !retried) {
            this.token = null; // app tokens have no refresh flow — re-mint and retry once
            return this.helixClip(slug, signal, true);
        }
        if (!res.ok) throw new Error(`twitch helix ${res.status}`);
        const j = (await res.json()) as {data?: HelixClip[]};
        const clip = j.data?.[0];
        if (!clip) throw new Error('twitch: clip not found');
        return clip;
    }

    // Best-effort: a clip embed without inline video is still useful, so GQL
    // failures return undefined instead of failing the whole resolve.
    private async clipMp4(
        slug: string,
        signal?: AbortSignal,
    ): Promise<EmbedMetadata['video']> {
        try {
            const res = await this.http.fetch('https://gql.twitch.tv/gql', {
                method: 'POST',
                headers: {
                    'Client-ID': this.config.twitchGqlClientId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    operationName: 'VideoAccessToken_Clip',
                    variables: {slug},
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: this.config.twitchGqlClipHash,
                        },
                    },
                }),
                signal,
            });
            if (!res.ok) return undefined;
            const j = (await res.json()) as {
                data?: {
                    clip?: {
                        playbackAccessToken?: {
                            value: string;
                            signature: string;
                        };
                        videoQualities?: {quality: string; sourceURL: string}[];
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
                mimeType: 'video/mp4',
            };
        } catch {
            return undefined;
        }
    }
}
