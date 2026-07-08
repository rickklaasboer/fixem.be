import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import Resolver from '@/domain/Resolver';

/**
 * Machine-readable adapter health for status monitoring (Gatus et al.).
 * Mirrors /preview/ but as single-line JSON so uptime checkers can assert on
 * it with JSONPath — glob/pattern matchers can't reliably match the
 * multi-line /preview/ HTML. Never throws (resolve() is guaranteed safe);
 * every matched, well-formed URL returns 200 with an outcome the checker
 * discriminates on (e.g. hasMedia == true, or platform == "threads").
 */
@injectable()
export default class StatusController {
    constructor(private resolver: Resolver) {}

    /**
     * `GET /api/status/adapter?url=...` — the monitoring contract. Field
     * names/shapes are load-bearing for Gatus checks; keep them exact.
     */
    public async adapter(c: Context): Promise<Response> {
        const raw = c.req.query('url');
        if (!raw) return c.json({error: 'unknown url'}, 400);
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            return c.json({error: 'unknown url'}, 400);
        }
        const outcome = await this.resolver.resolve(url);
        if (outcome.status === 'no-adapter')
            return c.json({
                platform: 'none',
                status: 'no-adapter',
                hasMedia: false,
            });
        if (outcome.status === 'degraded')
            return c.json({
                platform: outcome.platform,
                status: 'degraded',
                reason: outcome.reason,
                kind: 'link',
                hasMedia: false,
                canonicalUrl: outcome.canonicalUrl,
            });
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
