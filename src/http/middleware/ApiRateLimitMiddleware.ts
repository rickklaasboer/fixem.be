import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import Config from '@/config/Config';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';
import Clock from '@/services/Clock';
import Secrets from '@/support/Secrets';

/**
 * Per-API-key sliding-window rate limit for /api/v1/*. Buckets on a hash of the
 * bearer key (not client IP), so a caller's quota isn't shared across NATs or
 * diluted by IP spoofing, and no crawler bypass. Runs AFTER auth, so only a
 * validated key ever reaches here. Fails open on a store outage.
 */
@singleton()
export default class ApiRateLimitMiddleware implements Middleware {
    constructor(
        private config: Config,
        private store: RateLimitStore,
        private clock: Clock,
    ) {}

    public handle: MiddlewareHandler = async (c, next) => {
        const key = Secrets.bearer(c.req.header('Authorization'));
        const bucket = `api:${await Secrets.hash(key)}`;
        const limit = this.config.apiRateLimitPerMin;
        const hits = await this.store.hit(bucket, 60_000, this.clock.now());
        const remaining = Math.max(0, limit - hits);
        if (hits > limit) {
            c.header('X-RateLimit-Limit', String(limit));
            c.header('X-RateLimit-Remaining', '0');
            c.header('Retry-After', '60');
            return c.json({error: 'rate limited'}, 429);
        }
        await next();
        c.header('X-RateLimit-Limit', String(limit));
        c.header('X-RateLimit-Remaining', String(remaining));
    };
}
