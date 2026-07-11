import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';
import ApiConfig from '@/config/ApiConfig';
import AppConfig from '@/config/AppConfig';
import RateLimitConfig from '@/config/RateLimitConfig';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';
import MemoryRateLimitStore from '@/services/rate-limit/MemoryRateLimitStore';
import type Clock from '@/services/Clock';
import Crawler from '@/support/Crawler';
import Logger from '@/services/Logger';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';

describe('ApiAuthMiddleware', () => {
    const build = (keys: string[]) => {
        const tracker = new UsageTracker(
            new MetricsStore(null, new Logger({write: () => {}})),
            {now: () => 0} as unknown as Clock,
            new Logger({write: () => {}}),
        );
        const mw = new ApiAuthMiddleware(
            {keys} as unknown as ApiConfig,
            tracker,
        );
        const app = new Hono();
        app.use('/api/*', mw.handle);
        app.get('/api/thing', (c) => c.json({ok: true}));
        return app;
    };

    test('404s when no keys are configured', async () => {
        const res = await build([]).request('/api/thing');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({error: 'not found'});
    });

    test('401s on a missing or wrong bearer token', async () => {
        const app = build(['secret']);
        expect((await app.request('/api/thing')).status).toBe(401);
        const wrong = await app.request('/api/thing', {
            headers: {Authorization: 'Bearer nope'},
        });
        expect(wrong.status).toBe(401);
        expect(await wrong.json()).toEqual({error: 'unauthorized'});
    });

    test('passes through with any configured key', async () => {
        const app = build(['k1', 'k2']);
        const res = await app.request('/api/thing', {
            headers: {Authorization: 'Bearer k2'},
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ok: true});
    });

    test('accepts a case-insensitive scheme and extra whitespace (RFC 6750)', async () => {
        const app = build(['secret']);
        for (const h of [
            'Bearer secret',
            'bearer secret',
            'BEARER secret',
            'Bearer   secret',
        ]) {
            const res = await app.request('/api/thing', {
                headers: {Authorization: h},
            });
            expect(res.status).toBe(200);
        }
    });
});

describe('RateLimitMiddleware', () => {
    function buildApp(rateLimitPerMin: number) {
        const appConfig = Object.assign(new AppConfig(), {
            port: 3000,
            publicBaseUrl: 'https://fixem.be',
            extraCrawlerUas: [],
        });
        const rateLimit = Object.assign(new RateLimitConfig(), {
            perMin: rateLimitPerMin,
        });
        const store = new MemoryRateLimitStore();
        const clock = {now: () => 1_000} as Clock;
        const mw = new RateLimitMiddleware(
            appConfig,
            rateLimit,
            store,
            clock,
            new Crawler(),
        );
        const app = new Hono();
        app.use('*', mw.handle);
        app.get('/thing', (c) => c.text('ok'));
        return app;
    }

    test('a crawler UA bypasses the limit, even far over it', async () => {
        const app = buildApp(1);
        for (let i = 0; i < 5; i++) {
            const res = await app.request('/thing', {
                headers: {'User-Agent': 'Discordbot/2.0'},
            });
            expect(res.status).toBe(200);
        }
    });

    test('a non-crawler over the limit gets 429', async () => {
        const app = buildApp(1);
        const first = await app.request('/thing', {
            headers: {'User-Agent': 'Mozilla/5.0'},
        });
        expect(first.status).toBe(200);
        const second = await app.request('/thing', {
            headers: {'User-Agent': 'Mozilla/5.0'},
        });
        expect(second.status).toBe(429);
        expect(await second.text()).toBe('rate limited, try again shortly');
    });

    test('a non-crawler under the limit passes (e.g. a /preview/ hit)', async () => {
        const app = buildApp(10);
        const res = await app.request('/thing', {
            headers: {'User-Agent': 'Mozilla/5.0'},
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
    });
});
