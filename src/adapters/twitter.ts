import type {EmbedMetadata, FetchFn, PlatformAdapter} from './types';
import {truncate} from '../lib/text';
import {PLATFORM_UA, withSignal} from '../lib/http';
import {SYNDICATION_FEATURES} from '@/config/defaults';

// Re-export the relocated syndication feature flags so existing importers
// (lib/config.ts, tests) keep resolving them from this module. Removed when this
// adapter is converted to a class.
export {SYNDICATION_FEATURES};

const HOSTS = new Set([
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
    'x.com',
    'www.x.com',
    'mobile.x.com',
]);
// (?=\/|$) — a malformed ID like /status/123abc must not match-and-truncate
// to tweet 123.
const PATH_RE = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,20})(?=\/|$)/;

// Required by the syndication endpoint or it 404s (react-tweet algorithm, verbatim).
export function syndicationToken(id: string): string {
    return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

interface SynUser {
    name?: string;
    screen_name?: string;
}

interface SynMediaDetail {
    type?: string;
    media_url_https?: string;
    original_info?: {width?: number; height?: number};
    video_info?: {
        variants?: {bitrate?: number; content_type?: string; url?: string}[];
    };
}

interface SynTweet {
    __typename?: string;
    text?: string;
    possibly_sensitive?: boolean;
    user?: SynUser;
    photos?: {url: string; width?: number; height?: number}[];
    mediaDetails?: SynMediaDetail[];
    quoted_tweet?: {text?: string; user?: SynUser};
}

function parts(url: URL): {user: string; id: string} | null {
    const m = url.pathname.match(PATH_RE);
    return m ? {user: m[1]!, id: m[2]!} : null;
}

export function createTwitterAdapter(
    fetchFn: FetchFn = fetch,
    features: string = SYNDICATION_FEATURES,
): PlatformAdapter {
    return {
        name: 'twitter',
        match(url) {
            return HOSTS.has(url.hostname) && parts(url) !== null;
        },
        canonicalize(url) {
            const p = parts(url)!;
            return `https://x.com/${p.user}/status/${p.id}`;
        },
        async resolve(url, signal): Promise<EmbedMetadata> {
            const f = withSignal(fetchFn, signal);
            const p = parts(url);
            if (!p) throw new Error('twitter: not a status URL');
            const canonical = `https://x.com/${p.user}/status/${p.id}`;
            const apiUrl =
                `https://cdn.syndication.twimg.com/tweet-result?id=${p.id}` +
                `&lang=en&token=${syndicationToken(p.id)}` +
                `&features=${encodeURIComponent(features)}`;
            const res = await f(apiUrl, {headers: {'User-Agent': PLATFORM_UA}});
            if (!res.ok) throw new Error(`twitter ${res.status}`);
            const j = (await res.json()) as SynTweet;
            if (!j?.__typename) throw new Error('twitter: tweet unavailable');

            if (j.__typename === 'TweetTombstone') {
                // Age-restricted/withheld posts return tombstones on every anonymous
                // API path — serve an honest text embed instead of a bare redirect.
                return {
                    kind: 'link',
                    title: `@${p.user}`,
                    description:
                        "This post is unavailable via Twitter's public API (deleted, withheld, or age-restricted).",
                    siteName: 'X (Twitter)',
                    themeColor: '#000000',
                    nsfw: false,
                    ttlSeconds: 600,
                    originalUrl: canonical,
                };
            }

            const screenName = j.user?.screen_name ?? p.user;
            const name = j.user?.name?.trim() || screenName;
            const descParts: string[] = [];
            const text = (j.text ?? '').trim();
            if (text) descParts.push(truncate(text, 300));

            let kind: EmbedMetadata['kind'] = 'link';
            let image: EmbedMetadata['image'];
            let video: EmbedMetadata['video'];

            const media = j.mediaDetails?.find(
                (d) => d.type === 'video' || d.type === 'animated_gif',
            );
            if (media?.video_info?.variants) {
                const best = media.video_info.variants
                    .filter((v) => v.content_type === 'video/mp4' && v.url)
                    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
                if (best?.url) {
                    kind = 'video';
                    video = {
                        url: best.url,
                        width: media.original_info?.width,
                        height: media.original_info?.height,
                        mimeType: 'video/mp4',
                    };
                    if (media.media_url_https)
                        image = {url: media.media_url_https};
                }
            }
            if (!video) {
                const photo = j.photos?.[0];
                if (photo) {
                    kind = 'image';
                    image = {
                        url: photo.url,
                        width: photo.width,
                        height: photo.height,
                    };
                    if ((j.photos?.length ?? 0) > 1)
                        descParts.push(`📷 ${j.photos!.length} images`);
                }
            }

            const quoted = j.quoted_tweet;
            if (quoted?.user?.screen_name) {
                const qText = (quoted.text ?? '').trim();
                descParts.push(
                    qText
                        ? `↪ @${quoted.user.screen_name}: ${truncate(qText, 120)}`
                        : `↪ @${quoted.user.screen_name}`,
                );
            }

            return {
                kind,
                title:
                    name === screenName
                        ? `@${screenName}`
                        : `${name} (@${screenName})`,
                description: descParts.length ? descParts.join(' ') : undefined,
                author: {name, url: `https://x.com/${screenName}`},
                siteName: 'X (Twitter)',
                themeColor: '#000000',
                image,
                video,
                nsfw: !!j.possibly_sensitive,
                originalUrl: canonical,
            };
        },
    };
}
