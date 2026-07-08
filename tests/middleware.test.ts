import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';
import type Config from '@/config/Config';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';
import MemoryRateLimitStore from '@/services/MemoryRateLimitStore';
import type Clock from '@/services/Clock';
import Crawler from '@/support/Crawler';

describe('ApiAuthMiddleware', () => {
    test('404s when no key is configured', async () => {
        const mw = new ApiAuthMiddleware({
            statusApiKey: '',
        } as unknown as Config);
        const app = new Hono();
        app.use('/api/*', mw.handle);
        app.get('/api/thing', (c) => c.json({ok: true}));

        const res = await app.request('/api/thing');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({error: 'not found'});
    });

    test('401s with a wrong X-Api-Key', async () => {
        const mw = new ApiAuthMiddleware({
            statusApiKey: 'secret',
        } as unknown as Config);
        const app = new Hono();
        app.use('/api/*', mw.handle);
        app.get('/api/thing', (c) => c.json({ok: true}));

        const res = await app.request('/api/thing', {
            headers: {'X-Api-Key': 'wrong'},
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({error: 'unauthorized'});
    });

    test('passes through to the downstream handler with the right key', async () => {
        const mw = new ApiAuthMiddleware({
            statusApiKey: 'secret',
        } as unknown as Config);
        const app = new Hono();
        app.use('/api/*', mw.handle);
        app.get('/api/thing', (c) => c.json({ok: true}));

        const res = await app.request('/api/thing', {
            headers: {'X-Api-Key': 'secret'},
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ok: true});
    });
});

describe('RateLimitMiddleware', () => {
    function buildApp(rateLimitPerMin: number) {
        const config = {
            rateLimitPerMin,
            extraCrawlerUas: [],
        } as unknown as Config;
        const store = new MemoryRateLimitStore();
        const clock = {now: () => 1_000} as Clock;
        const mw = new RateLimitMiddleware(config, store, clock, new Crawler());
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
