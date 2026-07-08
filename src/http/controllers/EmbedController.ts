import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import Resolver from '@/domain/Resolver';
import MetaHtmlRenderer from '@/render/MetaHtmlRenderer';
import VideoProxy from '@/services/VideoProxy';
import Crawler from '@/support/Crawler';
import Config from '@/config/Config';
import Logger from '@/services/Logger';
import TargetUrl from '@/support/TargetUrl';

const USAGE_HINT =
    'fixem.be — prepend https://fixem.be/ to a social media URL, e.g. https://fixem.be/https://www.reddit.com/r/pics/comments/abc';

/**
 * The catch-all embed/redirect/preview handler and the last-resort error
 * guard. Crawlers (and `/preview/`) get resolved + rendered embed HTML;
 * everyone else gets a 302. Rate limiting is applied upstream by middleware.
 */
@injectable()
export default class EmbedController {
    constructor(
        private resolver: Resolver,
        private renderer: MetaHtmlRenderer,
        private videoProxy: VideoProxy,
        private crawler: Crawler,
        private config: Config,
        private logger: Logger,
    ) {}

    private oembedUrlFor(canonicalUrl: string): string {
        return `${this.config.publicBaseUrl}/oembed?url=${encodeURIComponent(canonicalUrl)}`;
    }

    /**
     * `GET *` — branches on User-Agent: crawlers (and `/preview/`) resolve +
     * render an embed; browsers get a 302 to the canonical URL.
     */
    public async handle(c: Context): Promise<Response> {
        // The human-facing diagnostic hatch is `/preview/<wrapped-url>`. Strip the
        // prefix before parsing so the rest flows through exactly like a normal
        // wrapped URL. No collision: a wrapped target always starts with a scheme or
        // bare host-with-dot, so its first path segment is never literally `preview`.
        const preview = c.req.path.startsWith('/preview/');
        const targetPath = preview
            ? c.req.path.slice('/preview'.length)
            : c.req.path;
        const parsed = TargetUrl.parse(
            targetPath,
            new URL(c.req.url).search.slice(1),
        );
        if (!parsed.ok) return c.text(USAGE_HINT, 400);

        const ua = c.req.header('User-Agent');
        const crawler = this.crawler.isCrawler(ua, this.config.extraCrawlerUas);

        if (!crawler && !preview) {
            const canonical = this.resolver.canonicalFor(parsed.url);
            this.logger.info(
                {
                    platform: canonical?.platform ?? 'none',
                    outcome: 'redirect',
                    uaClass: 'browser',
                },
                'redirected',
            );
            return c.redirect(canonical?.canonicalUrl ?? parsed.url.href, 302);
        }

        const outcome = await this.resolver.resolve(parsed.url);
        if (outcome.status === 'no-adapter') {
            // Crawlers get a bare redirect (no embed to build). Under /preview/,
            // that redirect is invisible/confusing when debugging, so show why instead.
            if (preview)
                return c.html(this.renderer.previewNoAdapter(parsed.url.href));
            return c.redirect(parsed.url.href, 302);
        }

        const meta =
            outcome.status === 'ok'
                ? await this.videoProxy.rewrite(outcome.meta)
                : this.renderer.minimalMeta(outcome.canonicalUrl);
        this.logger.info(
            {
                platform: outcome.platform,
                outcome: outcome.status,
                cache:
                    outcome.status === 'ok'
                        ? outcome.cacheHit
                            ? 'hit'
                            : 'miss'
                        : 'n/a',
                uaClass: crawler ? 'crawler' : 'preview',
            },
            'embed served',
        );
        // Preview is a human-facing debug view: render the full diagnostic report
        // (outcome, visual card, parsed metadata, exact crawler HTML) and never cache
        // it. Crawlers get the plain meta HTML.
        if (preview) {
            c.header('Cache-Control', 'no-store');
            return c.html(
                this.renderer.previewReport({
                    platform: outcome.platform,
                    status: outcome.status,
                    cacheHit:
                        outcome.status === 'ok' ? outcome.cacheHit : undefined,
                    reason:
                        outcome.status === 'degraded'
                            ? outcome.reason
                            : undefined,
                    canonicalUrl: outcome.canonicalUrl,
                    meta,
                    oembedUrl: this.oembedUrlFor(outcome.canonicalUrl),
                }),
            );
        }
        // Don't let CDNs pin a transient failure for the full crawler TTL.
        c.header(
            'Cache-Control',
            outcome.status === 'ok' ? 'public, max-age=300' : 'no-store',
        );
        return c.html(
            this.renderer.render(meta, {
                oembedUrl: this.oembedUrlFor(outcome.canonicalUrl),
                refresh: true,
            }),
        );
    }

    /**
     * Last-resort guard for the global invariant: never 500 on a well-formed
     * URL. Degrades to a 302 to the parsed target, or the usage hint on 400.
     */
    public onError(err: Error, c: Context): Response {
        this.logger.error(
            {err: String(err), path: c.req.path},
            'unhandled error, degrading',
        );
        const parsed = TargetUrl.parse(
            c.req.path,
            new URL(c.req.url).search.slice(1),
        );
        if (parsed.ok) return c.redirect(parsed.url.href, 302);
        return c.text(USAGE_HINT, 400);
    }
}
