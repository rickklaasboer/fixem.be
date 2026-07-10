import {singleton} from 'tsyringe';
import type {MiddlewareHandler} from 'hono';
import type Middleware from '@/http/middleware/Middleware';
import AppConfig from '@/config/AppConfig';
import RateLimitConfig from '@/config/RateLimitConfig';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';
import Clock from '@/services/Clock';
import Crawler from '@/support/Crawler';

/**
 * Per-IP sliding-window rate limit that bypasses known crawlers. Applied to
 * /oembed and the catch-all; a non-crawler under /preview/ is still limited,
 * so the debug hatch can't bypass throttling into the resolver.
 */
@singleton()
export default class RateLimitMiddleware implements Middleware {
    constructor(
        private app: AppConfig,
        private rateLimit: RateLimitConfig,
        private store: RateLimitStore,
        private clock: Clock,
        private crawler: Crawler,
    ) {}

    public handle: MiddlewareHandler = async (c, next) => {
        if (
            this.crawler.isCrawler(
                c.req.header('User-Agent'),
                this.app.extraCrawlerUas,
            )
        ) {
            return next();
        }
        const hits = await this.store.hit(
            RateLimitStore.clientIp(c.req.raw.headers),
            60_000,
            this.clock.now(),
        );
        if (hits > this.rateLimit.perMin) {
            return c.text('rate limited, try again shortly', 429);
        }
        return next();
    };
}
