import {describe, expect, test} from 'bun:test';
import type {Hono} from 'hono';
import createTestApp from './support/createTestApp';
import {PLATFORM_CAPABILITIES} from '@/domain/platformCapabilities';
import type Config from '@/config/Config';
import type PlatformAdapter from '@/domain/PlatformAdapter';

const KEY = 'k-test';
const authed = (app: Hono, path: string, init: RequestInit = {}) =>
    app.request(path, {
        ...init,
        headers: {Authorization: `Bearer ${KEY}`, ...(init.headers ?? {})},
    });

const proxAdapter: PlatformAdapter = {
    name: 'prox',
    match: (u) => u.hostname === 'prox.test',
    canonicalize: (u) => `https://prox.test${u.pathname}`,
    resolve: async () => ({
        kind: 'video',
        title: 'vid',
        siteName: 'Prox',
        originalUrl: 'https://prox.test/1',
        video: {
            url: 'https://v16.tiktokcdn.com/a.mp4',
            mimeType: 'video/mp4',
            proxyHeaders: {Referer: 'https://www.tiktok.com/'},
        },
    }),
};

const cfg = (extra: Partial<Config> = {}): Partial<Config> => ({
    apiKeys: [KEY],
    proxySecret: 's',
    proxyHostAllowlist: ['tiktokcdn.com'],
    publicBaseUrl: 'https://fixem.be',
    ...extra,
});

describe('platformCapabilities', () => {
    test('covers the real platforms with the documented flag shape', () => {
        const byName = Object.fromEntries(
            PLATFORM_CAPABILITIES.map((p) => [p.name, p]),
        );
        for (const name of [
            'reddit',
            'bluesky',
            'twitter',
            'twitch',
            'threads',
            'tiktok',
            'instagram',
        ]) {
            expect(byName[name]).toBeDefined();
        }
        expect(byName.instagram!.needsCookie).toBe(true);
        expect(byName.threads!.video).toBe(false);
        // every row is fully specified (no missing flags)
        for (const p of PLATFORM_CAPABILITIES) {
            expect(typeof p.video).toBe('boolean');
            expect(typeof p.gallery).toBe('boolean');
            expect(typeof p.image).toBe('boolean');
            expect(typeof p.needsCookie).toBe('boolean');
            expect(['video', 'image', 'gallery', 'link']).toContain(
                p.degradesTo,
            );
        }
    });
});

describe('GET /api/v1/resolve', () => {
    test('401 without a bearer token; 404 when no keys configured', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        expect(
            (await app.request('/api/v1/resolve?url=https://prox.test/1'))
                .status,
        ).toBe(401);
        const closed = createTestApp({adapters: [proxAdapter]}); // no apiKeys
        expect(
            (await authed(closed, '/api/v1/resolve?url=https://prox.test/1'))
                .status,
        ).toBe(404);
    });

    test('ok: raw url + needsProxy, no playableUrl, no proxyHeaders leak', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await authed(app, '/api/v1/resolve?url=https://prox.test/1');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
        const body = (await res.json()) as Record<string, any>;
        expect(body.status).toBe('ok');
        expect(body.platform).toBe('prox');
        expect(body.video.url).toBe('https://v16.tiktokcdn.com/a.mp4');
        expect(body.video.needsProxy).toBe(true);
        expect(body.video.playableUrl).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('proxyHeaders');
        expect(JSON.stringify(body)).not.toContain('Referer');
    });

    test('media=proxied attaches a signed playableUrl', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await authed(
            app,
            '/api/v1/resolve?media=proxied&url=https://prox.test/1',
        );
        const body = (await res.json()) as Record<string, any>;
        expect(body.video.playableUrl).toStartWith('https://fixem.be/v/');
    });

    test('no-adapter and missing/malformed url', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const na = await authed(
            app,
            '/api/v1/resolve?url=https://unknown.dev/x',
        );
        expect(((await na.json()) as Record<string, any>).status).toBe(
            'no-adapter',
        );
        expect((await authed(app, '/api/v1/resolve')).status).toBe(400);
        expect(
            (await authed(app, '/api/v1/resolve?url=not-a-url')).status,
        ).toBe(400);
    });
});

describe('GET /api/v1/canonical', () => {
    test('returns platform + canonicalUrl without an upstream fetch', async () => {
        let fetched = false;
        const adapter: PlatformAdapter = {
            name: 'prox',
            match: (u) => u.hostname === 'prox.test',
            canonicalize: (u) => `https://prox.test${u.pathname}`,
            resolve: async () => {
                fetched = true;
                throw new Error('should not fetch');
            },
        };
        const app = createTestApp({config: cfg(), adapters: [adapter]});
        const res = await authed(
            app,
            '/api/v1/canonical?url=https://prox.test/abc',
        );
        expect(await res.json()).toEqual({
            platform: 'prox',
            canonicalUrl: 'https://prox.test/abc',
        });
        expect(fetched).toBe(false);
        const none = await authed(
            app,
            '/api/v1/canonical?url=https://unknown.dev/x',
        );
        expect(await none.json()).toEqual({platform: 'none'});
    });
});

describe('GET /api/v1/platforms', () => {
    test('lists only registered platforms with capability flags', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await authed(app, '/api/v1/platforms');
        const body = (await res.json()) as {platforms: {name: string}[]};
        // prox has no capability row → not advertised; the table is intersected
        expect(body.platforms).toEqual([]);
    });
});

describe('GET /api/v1/health', () => {
    test('no url → liveness {ok, redis}', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await authed(app, '/api/v1/health');
        expect(await res.json()).toEqual({ok: true, redis: true});
    });

    test('with url → adapter outcome payload (same shape as old status)', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await authed(
            app,
            '/api/v1/health?url=https://prox.test/1',
        );
        const body = (await res.json()) as Record<string, any>;
        expect(body.platform).toBe('prox');
        expect(body.status).toBe('ok');
        expect(body.hasMedia).toBe(true);
        expect(body.kind).toBe('video');
    });
});

describe('POST /api/v1/resolve (batch)', () => {
    const post = (app: Hono, body: unknown) =>
        authed(app, '/api/v1/resolve', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
        });

    test('resolves in request order with per-item isolation', async () => {
        const app = createTestApp({config: cfg(), adapters: [proxAdapter]});
        const res = await post(app, {
            urls: [
                'https://prox.test/1',
                'not a url',
                'https://unknown.dev/x',
            ],
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {results: Record<string, any>[]};
        expect(body.results).toHaveLength(3);
        expect(body.results[0]).toMatchObject({
            url: 'https://prox.test/1',
            status: 'ok',
            platform: 'prox',
        });
        expect(body.results[1]).toEqual({
            url: 'not a url',
            status: 'error',
            error: 'malformed url',
        });
        expect(body.results[2]).toMatchObject({
            url: 'https://unknown.dev/x',
            status: 'no-adapter',
        });
        expect(JSON.stringify(body)).not.toContain('proxyHeaders');
    });

    test('empty, non-array, or over-limit lists → 400', async () => {
        const app = createTestApp({
            config: cfg({batchMaxUrls: 2}),
            adapters: [proxAdapter],
        });
        expect((await post(app, {urls: []})).status).toBe(400);
        expect((await post(app, {urls: 'nope'})).status).toBe(400);
        expect(
            (
                await post(app, {
                    urls: ['a', 'b', 'c'].map((s) => `https://prox.test/${s}`),
                })
            ).status,
        ).toBe(400);
    });
});
