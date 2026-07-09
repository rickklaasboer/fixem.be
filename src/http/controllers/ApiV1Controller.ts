import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import Resolver from '@/domain/Resolver';
import PublicMetaRenderer from '@/render/PublicMetaRenderer';
import AdapterRegistry from '@/domain/AdapterRegistry';
import Cache from '@/services/cache/Cache';
import Config from '@/config/Config';
import {PLATFORM_CAPABILITIES} from '@/domain/platformCapabilities';

/**
 * The public /api/v1 surface. Thin: reuses Resolver.resolve()/canonicalFor()
 * verbatim and maps outcomes through PublicMetaRenderer (the single place that
 * strips proxyHeaders). Auth + rate limiting are applied by middleware.
 */
@injectable()
export default class ApiV1Controller {
    constructor(
        private resolver: Resolver,
        private publicMeta: PublicMetaRenderer,
        private registry: AdapterRegistry,
        private cache: Cache,
        private config: Config,
    ) {}

    private static parseUrl(raw: string | undefined): URL | null {
        if (!raw) return null;
        try {
            return new URL(raw);
        } catch {
            return null;
        }
    }

    /** `GET /api/v1/resolve?url=[&media=proxied]` */
    public async resolve(c: Context): Promise<Response> {
        const url = ApiV1Controller.parseUrl(c.req.query('url'));
        if (!url) return c.json({error: 'missing or malformed url'}, 400);
        const proxied = c.req.query('media') === 'proxied';
        const outcome = await this.resolver.resolve(url);
        return c.json(await this.publicMeta.toPublic(outcome, {proxied}));
    }

    /** `POST /api/v1/resolve` — bounded batch; results in request order. */
    public async resolveBatch(c: Context): Promise<Response> {
        let body: unknown;
        try {
            body = await c.req.json();
        } catch {
            return c.json({error: 'invalid json body'}, 400);
        }
        const urls = (body as {urls?: unknown}).urls;
        const proxied = (body as {media?: unknown}).media === 'proxied';
        if (!Array.isArray(urls) || urls.length === 0) {
            return c.json({error: 'urls must be a non-empty array'}, 400);
        }
        if (urls.length > this.config.batchMaxUrls) {
            return c.json(
                {error: `too many urls (max ${this.config.batchMaxUrls})`},
                400,
            );
        }
        const results = await Promise.all(
            urls.map(async (raw) => {
                if (typeof raw !== 'string') {
                    return {
                        url: String(raw),
                        status: 'error',
                        error: 'malformed url',
                    };
                }
                let url: URL;
                try {
                    url = new URL(raw);
                } catch {
                    return {url: raw, status: 'error', error: 'malformed url'};
                }
                const outcome = await this.resolver.resolve(url);
                return {
                    url: raw,
                    ...(await this.publicMeta.toPublic(outcome, {proxied})),
                };
            }),
        );
        return c.json({results});
    }

    /** `GET /api/v1/canonical?url=` — no upstream fetch. */
    public canonical(c: Context): Response {
        const url = ApiV1Controller.parseUrl(c.req.query('url'));
        if (!url) return c.json({error: 'missing or malformed url'}, 400);
        const r = this.resolver.canonicalFor(url);
        return c.json(
            r
                ? {platform: r.platform, canonicalUrl: r.canonicalUrl}
                : {platform: 'none'},
        );
    }

    /** `GET /api/v1/platforms` — capability table ∩ registered adapters. */
    public platforms(c: Context): Response {
        const registered = new Set(this.registry.list().map((a) => a.name));
        return c.json({
            platforms: PLATFORM_CAPABILITIES.filter((p) =>
                registered.has(p.name),
            ),
        });
    }

    /**
     * `GET /api/v1/health[?url=]` — with `url`, the adapter-outcome payload
     * (field names load-bearing for Gatus); without, `/healthz` liveness.
     */
    public async health(c: Context): Promise<Response> {
        const raw = c.req.query('url');
        if (!raw) return c.json({ok: true, redis: await this.cache.ping()});
        const url = ApiV1Controller.parseUrl(raw);
        if (!url) return c.json({error: 'unknown url'}, 400);
        const outcome = await this.resolver.resolve(url);
        if (outcome.status === 'no-adapter') {
            return c.json({
                platform: 'none',
                status: 'no-adapter',
                hasMedia: false,
            });
        }
        if (outcome.status === 'degraded') {
            return c.json({
                platform: outcome.platform,
                status: 'degraded',
                reason: outcome.reason,
                kind: 'link',
                hasMedia: false,
                canonicalUrl: outcome.canonicalUrl,
            });
        }
        return c.json({
            platform: outcome.platform,
            status: 'ok',
            kind: outcome.meta.kind,
            hasMedia: Boolean(outcome.meta.image || outcome.meta.video),
            cacheHit: outcome.cacheHit,
            canonicalUrl: outcome.canonicalUrl,
            title: outcome.meta.title,
        });
    }
}
