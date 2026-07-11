import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import UsageConfig from '@/config/UsageConfig';
import Secrets from '@/support/Secrets';

/**
 * Gates GET /api/v1/stats/* behind the dedicated ADMIN_API_KEYS set (global
 * usage data — NOT customer API_KEYS). With no admin key configured the whole
 * subtree 404s, so it is invisible by default. Mirrors ApiAuthMiddleware.
 */
@singleton()
export default class StatsAuthMiddleware implements Middleware {
    constructor(private config: UsageConfig) {}

    public handle: MiddlewareHandler = async (c, next) => {
        if (this.config.adminKeys.length === 0) {
            return c.json({error: 'not found'}, 404);
        }
        const provided = Secrets.bearer(c.req.header('Authorization'));
        for (const key of this.config.adminKeys) {
            if (await Secrets.match(provided, key)) {
                await next();
                return;
            }
        }
        return c.json({error: 'unauthorized'}, 401);
    };
}
