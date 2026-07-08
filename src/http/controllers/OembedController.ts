import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import Resolver from '@/domain/Resolver';
import OembedRenderer from '@/render/OembedRenderer';
import Config from '@/config/Config';

/**
 * Serves oEmbed JSON for a wrapped URL. Rate limiting is applied upstream by
 * middleware, not here.
 */
@injectable()
export default class OembedController {
    constructor(
        private resolver: Resolver,
        private renderer: OembedRenderer,
        private config: Config,
    ) {}

    /**
     * `GET /oembed?url=...` — 404 on a missing/unparseable/unresolvable url,
     * otherwise the rendered oEmbed JSON.
     */
    public async show(c: Context): Promise<Response> {
        const raw = c.req.query('url');
        if (!raw) return c.json({error: 'unknown url'}, 404);
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            return c.json({error: 'unknown url'}, 404);
        }
        const outcome = await this.resolver.resolve(url);
        if (outcome.status !== 'ok') return c.json({error: 'unknown url'}, 404);
        return c.json(
            this.renderer.render(outcome.meta, this.config.publicBaseUrl),
        );
    }
}
