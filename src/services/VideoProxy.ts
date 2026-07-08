import {singleton} from 'tsyringe';
import Config from '@/config/Config';
import ProxySigner from '@/services/ProxySigner';
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
        private config: Config,
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
     * Rewrite `meta.video.url` to a signed `/v/` proxy URL when the video
     * carries `proxyHeaders`, degrading to a link (`dropVideo`) when
     * proxying is disabled or the host isn't https/allowlisted.
     */
    public async rewrite(meta: EmbedMetadata): Promise<EmbedMetadata> {
        if (!meta.video?.proxyHeaders) return meta;
        // Proxy required but disabled → drop rather than emit an unplayable CDN URL.
        if (!this.config.proxySecret) return this.dropVideo(meta);
        // The /v/ route only fetches https allowlisted hosts, so a video whose host
        // isn't allowlisted would mint a token that always 403s — a player that
        // fails to load is worse than an honest thumbnail/link. Degrade + warn so
        // allowlist drift is visible instead of silently broken in Discord.
        let u: URL;
        try {
            u = new URL(meta.video.url);
        } catch {
            return this.dropVideo(meta);
        }
        if (
            u.protocol !== 'https:' ||
            !VideoProxy.isHostAllowed(
                u.hostname,
                this.config.proxyHostAllowlist,
            )
        ) {
            this.logger.warn(
                {host: u.hostname},
                'video host not proxyable (not https/allowlisted) — degrading to link',
            );
            return this.dropVideo(meta);
        }
        const token = await this.signer.sign(this.config.proxySecret, {
            url: meta.video.url,
            headers: meta.video.proxyHeaders,
            exp: this.clock.now() + PROXY_TOKEN_TTL_MS,
        });
        const {proxyHeaders, ...vid} = meta.video;
        return {
            ...meta,
            video: {
                ...vid,
                url: `${this.config.publicBaseUrl}/v/${token}`,
            },
        };
    }
}
