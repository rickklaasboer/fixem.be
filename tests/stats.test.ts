import {describe, expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import Logger from '@/services/Logger';
import MetricsStore from '@/services/metrics/MetricsStore';
import createTestApp from './support/createTestApp';

const silent = () => new Logger({write: () => {}});

function seededStore(): MetricsStore {
    const s = new MetricsStore(new Database(':memory:'), silent());
    s.flush({
        usage: [
            {
                day: '2026-07-11',
                platform: 'reddit',
                outcome: 'ok',
                cache: 'miss',
                uaClass: 'crawler',
                count: 4,
            },
        ],
        apiKey: [{day: '2026-07-11', keyId: 'h1', count: 9}],
        proxyBytes: [
            {day: '2026-07-11', platform: 'tiktok', bytes: 2048, requests: 3},
        ],
    });
    return s;
}

const bearer = (k: string) => ({Authorization: `Bearer ${k}`});

describe('GET /api/v1/stats/*', () => {
    test('404 when no ADMIN_API_KEYS configured', async () => {
        const app = createTestApp({metricsStore: seededStore()});
        const res = await app.request('/api/v1/stats/usage');
        expect(res.status).toBe(404);
    });

    test('401 on missing/wrong admin bearer', async () => {
        const app = createTestApp({
            metricsStore: seededStore(),
            usage: {adminKeys: ['admin-secret']},
        });
        expect((await app.request('/api/v1/stats/usage')).status).toBe(401);
        const wrong = await app.request('/api/v1/stats/usage', {
            headers: bearer('nope'),
        });
        expect(wrong.status).toBe(401);
    });

    test('a customer API key does NOT unlock stats', async () => {
        const app = createTestApp({
            metricsStore: seededStore(),
            usage: {adminKeys: ['admin-secret']},
            api: {keys: ['cust-key']},
        });
        const res = await app.request('/api/v1/stats/usage', {
            headers: bearer('cust-key'),
        });
        expect(res.status).toBe(401);
    });

    test('admin key returns usage / keys / bandwidth rows for a range', async () => {
        const app = createTestApp({
            metricsStore: seededStore(),
            usage: {adminKeys: ['admin-secret']},
        });
        const q = '?from=2026-07-01&to=2026-07-31';
        const usage = await (
            await app.request(`/api/v1/stats/usage${q}`, {
                headers: bearer('admin-secret'),
            })
        ).json();
        expect(usage.rows).toContainEqual({
            day: '2026-07-11',
            platform: 'reddit',
            outcome: 'ok',
            cache: 'miss',
            uaClass: 'crawler',
            count: 4,
        });
        const keys = await (
            await app.request(`/api/v1/stats/keys${q}`, {
                headers: bearer('admin-secret'),
            })
        ).json();
        expect(keys.rows).toEqual([{day: '2026-07-11', keyId: 'h1', count: 9}]);
        const bw = await (
            await app.request(`/api/v1/stats/bandwidth${q}`, {
                headers: bearer('admin-secret'),
            })
        ).json();
        expect(bw.rows).toEqual([
            {day: '2026-07-11', platform: 'tiktok', bytes: 2048, requests: 3},
        ]);
    });

    test('malformed date range → 400', async () => {
        const app = createTestApp({
            metricsStore: seededStore(),
            usage: {adminKeys: ['admin-secret']},
        });
        const res = await app.request('/api/v1/stats/usage?from=bogus', {
            headers: bearer('admin-secret'),
        });
        expect(res.status).toBe(400);
    });

    test('customer /api/v1/resolve still gated by API_KEYS (regression)', async () => {
        const app = createTestApp({
            usage: {adminKeys: ['admin-secret']},
            api: {keys: ['cust-key']},
        });
        // No bearer → 401 from customer auth (still applied to the customer route).
        expect(
            (await app.request('/api/v1/resolve?url=https://example.com/x'))
                .status,
        ).toBe(401);
    });
});
