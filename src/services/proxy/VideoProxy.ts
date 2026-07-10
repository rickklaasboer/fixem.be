import {singleton} from 'tsyringe';
import ProxyConfig from '@/config/ProxyConfig';
import AppConfig from '@/config/AppConfig';
import ProxySigner from '@/services/proxy/ProxySigner';
import Clock from '@/services/Clock';
import Logger from '@/services/Logger';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const PROXY_TOKEN_TTL_MS = 3_600_000;

/**
 * Rewrites `EmbedMetadata.video` into a signed `/v/` proxy URL for CDNs that
 * need headers Discord won't forward, degrading to a link when proxying
 * isn't possible (disabled, or the host isn't https/allowlisted).
 */
@singleton()
export default class VideoProxy {
    constructor(
        private proxy: ProxyConfig,
        private app: AppConfig,
        private signer: ProxySigner,
        private clock: Clock,
        private logger: Logger,
    ) {}

    /**
     * Suffix match on a parsed hostname (exact host or a dot-boundary
     * subdomain). Exported so the app can reject at mint time what the proxy
     * would 403 at fetch.
     */
    public static isHostAllowed(host: string, allowlist: string[]): boolean {
        const h = host.toLowerCase();
        return allowlist.some(
            (suffix) => h === suffix || h.endsWith(`.${suffix}`),
        );
    }

    private dropVideo(meta: EmbedMetadata): EmbedMetadata {
        const {video, ...rest} = meta;
        return {...rest, kind: meta.kind === 'video' ? 'link' : meta.kind};
    }

    /**
     * Sign `video` into a `/v/<token>` proxy URL, or return `null` when
     * proxying is disabled, the URL isn't https, or its host isn't
     * allowlisted (a token there would 403 at /v/). Pure: never mutates
     * `video`, never logs. Shared by `rewrite()` (HTML path) and the public
     * API mapper (`PublicMetaRenderer`).
     */
    public async signedUrlFor(
        video: NonNullable<EmbedMetadata['video']>,
    ): Promise<string | null> {
        if (!video.proxyHeaders) return null;
        if (!this.proxy.secret) return null;
        let u: URL;
        try {
            u = new URL(video.url);
        } catch {
            return null;
        }
        if (
            u.protocol !== 'https:' ||
            !VideoProxy.isHostAllowed(u.hostname, this.proxy.hostAllowlist)
        ) {
            return null;
        }
        const token = await this.signer.sign(this.proxy.secret, {
            url: video.url,
            headers: video.proxyHeaders,
            exp: this.clock.now() + PROXY_TOKEN_TTL_MS,
        });
        return `${this.app.publicBaseUrl}/v/${token}`;
    }

    /**
     * Rewrite `meta.video.url` to a signed `/v/` proxy URL when the video
     * carries `proxyHeaders`, degrading to a link (`dropVideo`) when
     * proxying is disabled or the host isn't https/allowlisted.
     */
    public async rewrite(meta: EmbedMetadata): Promise<EmbedMetadata> {
        if (!meta.video?.proxyHeaders) return meta;
        // Proxy required but disabled → drop rather than emit an unplayable CDN URL.
        if (!this.proxy.secret) return this.dropVideo(meta);
        const signed = await this.signedUrlFor(meta.video);
        // proxySecret is set, so a null here means the /v/ route only fetches https
        // allowlisted hosts and this one isn't — a minted token would always 403. A
        // player that fails to load is worse than an honest thumbnail/link. Degrade +
        // warn so allowlist drift is visible instead of silently broken in Discord.
        if (!signed) {
            this.logger.warn(
                {url: meta.video.url},
                'video host not proxyable (not https/allowlisted) — degrading to link',
            );
            return this.dropVideo(meta);
        }
        const {proxyHeaders, ...vid} = meta.video;
        return {
            ...meta,
            video: {
                ...vid,
                url: signed,
            },
        };
    }
}
