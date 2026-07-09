import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import Config from '@/config/Config';
import Secrets from '@/support/Secrets';

/**
 * Gates the /api/v1/* surface behind a constant-time bearer-token check
 * against the configured API_KEYS set. With no key configured the whole
 * namespace 404s, so it is never reachable unauthenticated by default.
 */
@singleton()
export default class ApiAuthMiddleware implements Middleware {
    constructor(private config: Config) {}

    public handle: MiddlewareHandler = async (c, next) => {
        if (this.config.apiKeys.length === 0) {
            return c.json({error: 'not found'}, 404);
        }
        const auth = c.req.header('Authorization') ?? '';
        const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        for (const key of this.config.apiKeys) {
            if (await Secrets.match(provided, key)) {
                await next();
                return;
            }
        }
        return c.json({error: 'unauthorized'}, 401);
    };
}
