import {injectable} from 'tsyringe';
import VideoProxy from '@/services/proxy/VideoProxy';
import type EmbedMetadata from '@/domain/EmbedMetadata';
import type ResolveOutcome from '@/domain/ResolveOutcome';

export interface PublicVideo {
    url: string; // raw upstream, always present
    width?: number;
    height?: number;
    mimeType: string;
    needsProxy: boolean; // upstream is IP/cookie-locked
    playableUrl?: string; // signed /v/ URL, only on ?media=proxied
}

export interface PublicResult {
    status: 'ok' | 'degraded' | 'no-adapter';
    platform?: string;
    canonicalUrl?: string;
    cacheHit?: boolean;
    reason?: string;
    kind?: EmbedMetadata['kind'];
    title?: string;
    description?: string;
    author?: {name: string; url?: string};
    siteName?: string;
    themeColor?: string;
    nsfw?: boolean;
    image?: {url: string; width?: number; height?: number};
    video?: PublicVideo;
}

/**
 * Maps a resolver outcome to the public JSON contract. THE single choke point
 * that strips `video.proxyHeaders` (a full account credential / CDN tokens),
 * derives the `needsProxy` boolean, drops internal fields (`ttlSeconds`,
 * `originalUrl`), and — only on `proxied` — attaches a signed `playableUrl`.
 */
@injectable()
export default class PublicMetaRenderer {
    constructor(private videoProxy: VideoProxy) {}

    public async toPublic(
        outcome: ResolveOutcome,
        opts: {proxied: boolean},
    ): Promise<PublicResult> {
        if (outcome.status === 'no-adapter') {
            return {status: 'no-adapter', platform: 'none'};
        }
        if (outcome.status === 'degraded') {
            return {
                status: 'degraded',
                platform: outcome.platform,
                canonicalUrl: outcome.canonicalUrl,
                reason: outcome.reason,
                kind: 'link',
            };
        }
        const m = outcome.meta;
        const result: PublicResult = {
            status: 'ok',
            platform: outcome.platform,
            canonicalUrl: outcome.canonicalUrl,
            cacheHit: outcome.cacheHit,
            kind: m.kind,
            title: m.title,
            description: m.description,
            author: m.author,
            siteName: m.siteName,
            themeColor: m.themeColor,
            nsfw: m.nsfw,
            image: m.image,
        };
        if (m.video) {
            const video: PublicVideo = {
                url: m.video.url,
                width: m.video.width,
                height: m.video.height,
                mimeType: m.video.mimeType,
                needsProxy: Boolean(m.video.proxyHeaders),
            };
            if (opts.proxied) {
                const signed = await this.videoProxy.signedUrlFor(m.video);
                if (signed) video.playableUrl = signed;
            }
            result.video = video;
        }
        return result;
    }
}
