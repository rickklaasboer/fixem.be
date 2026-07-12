import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import ApiConfig from '@/config/ApiConfig';
import Secrets from '@/support/Secrets';
import UsageTracker from '@/services/metrics/UsageTracker';

/**
 * Gates the /api/v1/* surface behind a constant-time bearer-token check
 * against the configured API_KEYS set. With no key configured the whole
 * namespace 404s, so it is never reachable unauthenticated by default.
 */
@singleton()
export default class ApiAuthMiddleware implements Middleware {
    constructor(
        private config: ApiConfig,
        private usage: UsageTracker,
    ) {}

    public handle: MiddlewareHandler = async (c, next) => {
        if (this.config.keys.length === 0) {
            return c.json({error: 'not found'}, 404);
        }
        const provided = Secrets.bearer(c.req.header('Authorization'));
        for (const key of this.config.keys) {
            if (await Secrets.match(provided, key)) {
                // Count every authenticated request (incl. ones later 429'd).
                this.usage.recordApiKey(await Secrets.hash(provided));
                await next();
                return;
            }
        }
        return c.json({error: 'unauthorized'}, 401);
    };
}
