import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';
import type ResolveOutcome from '@/domain/ResolveOutcome';
import type Resolver from '@/domain/Resolver';
import StatusController from '@/http/controllers/StatusController';

/**
 * Pins the JSON contract Gatus (and any other uptime checker) discriminates
 * on: field names/shapes for each ResolveOutcome status must not drift.
 */
function buildApp(outcome: ResolveOutcome): Hono {
    const resolver = {resolve: async () => outcome} as unknown as Resolver;
    const controller = new StatusController(resolver);
    const app = new Hono();
    app.get('/api/status/adapter', (c) => controller.adapter(c));
    return app;
}

describe('StatusController#adapter', () => {
    test('no-adapter → platform none, status no-adapter, hasMedia false', async () => {
        const app = buildApp({status: 'no-adapter'});
        const res = await app.request(
            '/api/status/adapter?url=https://example.com/x',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            platform: 'none',
            status: 'no-adapter',
            hasMedia: false,
        });
    });

    test('degraded → platform/reason/kind link/hasMedia false/canonicalUrl', async () => {
        const app = buildApp({
            status: 'degraded',
            canonicalUrl: 'https://reddit.com/r/pics/1',
            platform: 'reddit',
            reason: 'timeout',
        });
        const res = await app.request(
            '/api/status/adapter?url=https://reddit.com/r/pics/1',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            platform: 'reddit',
            status: 'degraded',
            reason: 'timeout',
            kind: 'link',
            hasMedia: false,
            canonicalUrl: 'https://reddit.com/r/pics/1',
        });
    });

    test('ok with media → hasMedia true, includes cacheHit/canonicalUrl/title/kind', async () => {
        const app = buildApp({
            status: 'ok',
            canonicalUrl: 'https://twitter.com/x/status/1',
            platform: 'twitter',
            cacheHit: true,
            meta: {
                kind: 'image',
                title: 'a tweet',
                siteName: 'X',
                image: {url: 'https://example.com/img.jpg'},
                originalUrl: 'https://twitter.com/x/status/1',
            },
        });
        const res = await app.request(
            '/api/status/adapter?url=https://twitter.com/x/status/1',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            platform: 'twitter',
            status: 'ok',
            kind: 'image',
            hasMedia: true,
            cacheHit: true,
            canonicalUrl: 'https://twitter.com/x/status/1',
            title: 'a tweet',
        });
    });

    test('ok without media → hasMedia false', async () => {
        const app = buildApp({
            status: 'ok',
            canonicalUrl: 'https://threads.net/@x/post/1',
            platform: 'threads',
            cacheHit: false,
            meta: {
                kind: 'link',
                title: 'a thread',
                siteName: 'Threads',
                originalUrl: 'https://threads.net/@x/post/1',
            },
        });
        const res = await app.request(
            '/api/status/adapter?url=https://threads.net/@x/post/1',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            platform: 'threads',
            status: 'ok',
            kind: 'link',
            hasMedia: false,
            cacheHit: false,
            canonicalUrl: 'https://threads.net/@x/post/1',
            title: 'a thread',
        });
    });

    test('missing url → 400', async () => {
        const app = buildApp({status: 'no-adapter'});
        const res = await app.request('/api/status/adapter');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({error: 'unknown url'});
    });

    test('unparseable url → 400', async () => {
        const app = buildApp({status: 'no-adapter'});
        const res = await app.request('/api/status/adapter?url=not-a-url');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({error: 'unknown url'});
    });
});
