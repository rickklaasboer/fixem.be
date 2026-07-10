import {injectable} from 'tsyringe';
import BaseAdapter from '@/adapters/BaseAdapter';
import TiktokConfig from '@/config/TiktokConfig';
import HttpClient, {CHROME_UA} from '@/services/HttpClient';
import Text from '@/support/Text';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const MAIN_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const POST_RE = /^\/@([^/]+)\/(video|photo)\/(\d+)\/?$/;
const SHORT_PATH_RE = /^\/t\/[^/]+/; // /t/<short> on a main host is a share link
const VIDEO_HTML_RE = /\/v\/(\d+)\.html/; // mobile redirect variant

const MEDIA_TTL_SECONDS = 3600;

// TikTok's signed play URLs are bound to the session that scraped the page: they
// 403 unless replayed with the ttwid/tt_csrf cookies the page set, plus a
// browser UA and Referer. We capture those cookies at resolve time and hand them
// to the /v/ proxy (which fetches from the same egress IP the cookies were
// issued to). ttwid is a low-sensitivity tracking cookie, not a credential.
function cookieHeaderFrom(res: Response): string {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    return setCookies
        .map((c) => c.split(';')[0]?.trim())
        .filter((c): c is string => !!c)
        .join('; ');
}

function mediaProxyHeaders(cookie: string): Record<string, string> {
    return {
        'User-Agent': CHROME_UA,
        Referer: 'https://www.tiktok.com/',
        ...(cookie ? {Cookie: cookie} : {}),
    };
}

interface ItemStruct {
    id?: string;
    desc?: string;
    author?: {nickname?: string; uniqueId?: string};
    video?: {
        width?: number;
        height?: number;
        cover?: string;
        playAddr?: string;
        bitrateInfo?: {Bitrate?: number; PlayAddr?: {UrlList?: string[]}}[];
    };
    imagePost?: {images?: {imageURL?: {urlList?: string[]}}[]};
}

function isShortLink(url: URL): boolean {
    return (
        SHORT_HOSTS.has(url.hostname) ||
        (MAIN_HOSTS.has(url.hostname) && SHORT_PATH_RE.test(url.pathname))
    );
}

// Normalize a resolved location into a canonical full-post URL, or null.
function toFullPost(location: string): string | null {
    let path: string;
    try {
        path = new URL(location).pathname;
    } catch {
        path = location;
    }
    const html = path.match(VIDEO_HTML_RE);
    if (html) return `https://www.tiktok.com/@i/video/${html[1]}`;
    const m = path.match(POST_RE);
    return m ? `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` : null;
}

function canonicalFullPost(url: URL): string {
    const m = url.pathname.match(POST_RE);
    return m ? `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` : url.href;
}

/**
 * TikTok video/photo-post embeds via the web page's embedded rehydration
 * JSON; signed play URLs are streamed through the /v/ proxy with the page's
 * session cookies forwarded.
 */
@injectable()
export default class TiktokAdapter extends BaseAdapter {
    public name = 'tiktok';

    constructor(
        private config: TiktokConfig,
        private http: HttpClient,
    ) {
        super();
    }

    public match(url: URL): boolean {
        if (SHORT_HOSTS.has(url.hostname))
            return url.pathname !== '/' && url.pathname !== '';
        if (MAIN_HOSTS.has(url.hostname))
            return (
                POST_RE.test(url.pathname) || SHORT_PATH_RE.test(url.pathname)
            );
        return false;
    }

    public canonicalize(url: URL): string {
        return isShortLink(url) ? url.href : canonicalFullPost(url);
    }

    /**
     * Resolve a TikTok video/photo post into embed metadata.
     */
    public async resolve(
        url: URL,
        signal?: AbortSignal,
    ): Promise<EmbedMetadata> {
        // Short links resolve to the real post via a manual redirect probe.
        let pageUrl: string;
        if (isShortLink(url)) {
            const probe = await this.http.fetch(url.href, {
                headers: {'User-Agent': CHROME_UA},
                redirect: 'manual',
                signal,
            });
            const full = toFullPost(probe.headers.get('Location') ?? '');
            if (!full)
                throw new Error('tiktok: short link did not resolve to a post');
            pageUrl = full;
        } else {
            pageUrl = canonicalFullPost(url);
        }

        const res = await this.http.fetch(pageUrl, {
            headers: {'User-Agent': CHROME_UA},
            signal,
        });
        if (!res.ok) throw new Error(`tiktok ${res.status}`);
        const cookie = cookieHeaderFrom(res);
        const {statusCode, itemStruct} = this.extractItemDetail(
            await res.text(),
        );

        if (statusCode === 10204) throw new Error('tiktok: not found');
        if (statusCode === 209002 || statusCode === 209004 || !itemStruct) {
            return this.linkCard({
                title: 'TikTok',
                description: 'This TikTok is region-restricted or private.',
                siteName: 'TikTok',
                themeColor: '#FE2C55',
                ttlSeconds: 600,
                originalUrl: pageUrl,
            });
        }

        const uniqueId = itemStruct.author?.uniqueId ?? 'tiktok';
        const nickname = itemStruct.author?.nickname?.trim() || uniqueId;
        const descParts: string[] = [];
        const desc = (itemStruct.desc ?? '').trim();
        if (desc) descParts.push(Text.truncate(desc, 300));

        let kind: EmbedMetadata['kind'] = 'link';
        let image: EmbedMetadata['image'];
        let video: EmbedMetadata['video'];

        const photos = itemStruct.imagePost?.images;
        if (photos && photos.length > 0) {
            kind = 'image';
            const first = photos[0]?.imageURL?.urlList?.[0];
            if (first) image = {url: first};
            if (photos.length > 1) descParts.push(`📷 ${photos.length} images`);
        } else if (itemStruct.video) {
            const v = itemStruct.video;
            let best:
                | {Bitrate?: number; PlayAddr?: {UrlList?: string[]}}
                | undefined;
            for (const b of v.bitrateInfo ?? []) {
                if (
                    b?.PlayAddr?.UrlList?.[0] &&
                    (!best || (b.Bitrate ?? 0) > (best.Bitrate ?? 0))
                )
                    best = b;
            }
            const playUrl = best?.PlayAddr?.UrlList?.[0] ?? v.playAddr;
            if (playUrl) {
                kind = 'video';
                video = {
                    url: playUrl,
                    width: v.width,
                    height: v.height,
                    mimeType: 'video/mp4',
                    proxyHeaders: mediaProxyHeaders(cookie),
                };
                if (v.cover) image = {url: v.cover};
            }
        }

        const hasMedia = kind === 'video' || kind === 'image';
        return {
            kind,
            title:
                nickname === uniqueId
                    ? `@${uniqueId}`
                    : `${nickname} (@${uniqueId})`,
            description: descParts.length ? descParts.join(' ') : undefined,
            author: {
                name: nickname,
                url: `https://www.tiktok.com/@${uniqueId}`,
            },
            siteName: 'TikTok',
            themeColor: '#FE2C55',
            image,
            video,
            nsfw: false,
            ttlSeconds: hasMedia ? MEDIA_TTL_SECONDS : undefined,
            originalUrl: pageUrl,
        };
    }

    /**
     * Pull the video-detail item struct out of TikTok's embedded rehydration
     * JSON, keyed by the (env-overridable) script id.
     */
    private extractItemDetail(html: string): {
        statusCode?: number;
        itemStruct?: ItemStruct;
    } {
        const marker = `<script id="${this.config.rehydrationScriptId}" type="application/json">`;
        const start = html.indexOf(marker);
        if (start < 0) throw new Error('tiktok: rehydration data not found');
        const from = start + marker.length;
        // Safe because TikTok escapes `<` as < inside the JSON payload, so the
        // next literal </script> is always the script's real end tag.
        const end = html.indexOf('</script>', from);
        if (end < 0) throw new Error('tiktok: rehydration data truncated');
        const scope = JSON.parse(html.slice(from, end)) as {
            __DEFAULT_SCOPE__?: {
                'webapp.video-detail'?: {
                    statusCode?: number;
                    itemInfo?: {itemStruct?: ItemStruct};
                };
            };
        };
        const detail = scope.__DEFAULT_SCOPE__?.['webapp.video-detail'];
        return {
            statusCode: detail?.statusCode,
            itemStruct: detail?.itemInfo?.itemStruct,
        };
    }
}
