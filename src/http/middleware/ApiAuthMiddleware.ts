import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import Config from '@/config/Config';
import Secrets from '@/support/Secrets';

/**
 * Gates the authenticated /api/* surface behind a constant-time X-Api-Key
 * check. With no key configured the whole namespace 404s, so it is never
 * reachable unauthenticated by default.
 */
@singleton()
export default class ApiAuthMiddleware implements Middleware {
    constructor(private config: Config) {}

    public handle: MiddlewareHandler = async (c, next) => {
        if (!this.config.statusApiKey) {
            return c.json({error: 'not found'}, 404);
        }
        const provided = c.req.header('X-Api-Key') ?? '';
        if (!(await Secrets.match(provided, this.config.statusApiKey))) {
            return c.json({error: 'unauthorized'}, 401);
        }
        await next();
    };
}
