import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';
import ApiRateLimitMiddleware from '@/http/middleware/ApiRateLimitMiddleware';
import MemoryRateLimitStore from '@/services/rate-limit/MemoryRateLimitStore';
import type ApiConfig from '@/config/ApiConfig';
import type Clock from '@/services/Clock';

function buildApp(perMin: number) {
    const config = {rateLimitPerMin: perMin} as unknown as ApiConfig;
    const clock = {now: () => 1_000} as Clock;
    const mw = new ApiRateLimitMiddleware(
        config,
        new MemoryRateLimitStore(),
        clock,
    );
    const app = new Hono();
    app.use('/api/v1/*', mw.handle);
    app.get('/api/v1/ping', (c) => c.json({ok: true}));
    return app;
}

const bearer = (k: string) => ({headers: {Authorization: `Bearer ${k}`}});

describe('ApiRateLimitMiddleware', () => {
    test('emits X-RateLimit headers and passes under the limit', async () => {
        const res = await buildApp(5).request('/api/v1/ping', bearer('k1'));
        expect(res.status).toBe(200);
        expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
    });

    test('429 with Retry-After past the limit', async () => {
        const app = buildApp(1);
        expect((await app.request('/api/v1/ping', bearer('k1'))).status).toBe(
            200,
        );
        const limited = await app.request('/api/v1/ping', bearer('k1'));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('60');
    });

    test('buckets per key — a second key is unaffected', async () => {
        const app = buildApp(1);
        expect((await app.request('/api/v1/ping', bearer('k1'))).status).toBe(
            200,
        );
        expect((await app.request('/api/v1/ping', bearer('k1'))).status).toBe(
            429,
        );
        expect((await app.request('/api/v1/ping', bearer('k2'))).status).toBe(
            200,
        );
    });
});
