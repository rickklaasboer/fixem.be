import {describe, expect, test} from 'bun:test';
import {buildApp, type AppDeps} from '../src/app';
import {loadConfig} from '../src/lib/config';
import {createLogger} from '../src/lib/logger';
import {MemoryCache} from '../src/lib/cache';
import {MemoryRateLimitStore} from '../src/lib/rate-limit';
import {Resolver} from '../src/resolver';
import {AdapterRegistry} from '../src/adapters/registry';
import {createDummyAdapter} from '../src/adapters/dummy';

const DISCORD_UA =
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const BROWSER_UA =
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

function makeApp(overrides: Partial<AppDeps> = {}) {
    const config = loadConfig({});
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const resolver = new Resolver({
        registry: new AdapterRegistry([createDummyAdapter()]),
        cache,
        logger,
        ttlSeconds: config.cacheTtlSeconds,
        timeoutMs: config.resolveTimeoutMs,
    });
    return buildApp({
        config,
        logger,
        cache,
        resolver,
        rateLimitStore: new MemoryRateLimitStore(),
        landingHtml: '<html>fixem.be landing</html>',
        ...overrides,
    });
}

function get(app: ReturnType<typeof makeApp>, path: string, ua: string) {
    return app.request(path, {headers: {'User-Agent': ua}});
}

describe('routes', () => {
    test('GET / serves landing page', async () => {
        const res = await get(makeApp(), '/', BROWSER_UA);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('fixem.be landing');
    });

    test('GET /healthz reports redis status', async () => {
        const res = await get(makeApp(), '/healthz', BROWSER_UA);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ok: true, redis: true});
    });

    test('crawler gets meta-HTML for matched URL', async () => {
        const res = await get(
            makeApp(),
            '/https://example.com/hello',
            DISCORD_UA,
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('og:title');
        expect(html).toContain('fixem.be works!');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    });

    test('browser gets 302 to canonical URL for matched URL', async () => {
        const res = await get(
            makeApp(),
            '/https://www.example.com/hello?utm=1',
            BROWSER_UA,
        );
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('https://example.com/hello');
    });

    test('browser on /preview/<url> gets a diagnostic report (no meta refresh)', async () => {
        const res = await get(
            makeApp(),
            '/preview/https://example.com/hello',
            BROWSER_UA,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store'); // debug view, never cached
        const html = await res.text();
        // Diagnostic report sections + resolution info.
        expect(html).toContain('/preview/');
        expect(html).toContain('Embed card');
        expect(html).toContain('Metadata');
        expect(html).toContain('Crawler HTML');
        expect(html).toContain('dummy'); // platform name
        expect(html).toContain('cache miss'); // resolution status
        expect(html).toContain('fixem.be works!'); // the resolved title
        // The exact crawler HTML is embedded (escaped) for inspection.
        expect(html).toContain('og:title');
        // Preview is for inspecting in a browser; it must not instantly navigate away
        // — the embedded crawler HTML is rendered with refresh disabled.
        expect(html).not.toContain('http-equiv="refresh"');
    });

    test('crawler meta-HTML keeps the meta refresh', async () => {
        const res = await get(
            makeApp(),
            '/https://example.com/hello',
            DISCORD_UA,
        );
        expect(await res.text()).toContain('http-equiv="refresh"');
    });

    test('unmatched valid URL redirects for both crawler and browser', async () => {
        const a = await get(
            makeApp(),
            '/https://unknown-platform.dev/x',
            DISCORD_UA,
        );
        expect(a.status).toBe(302);
        expect(a.headers.get('Location')).toBe(
            'https://unknown-platform.dev/x',
        );
        const b = await get(
            makeApp(),
            '/https://unknown-platform.dev/x',
            BROWSER_UA,
        );
        expect(b.status).toBe(302);
    });

    test('no-adapter URL redirects a browser but shows a diagnostic under /preview/', async () => {
        // unknown-platform.dev has no adapter registered (dummy only matches example.com).
        const redirect = await get(
            makeApp(),
            '/https://unknown-platform.dev/x',
            BROWSER_UA,
        );
        expect(redirect.status).toBe(302);

        const preview = await get(
            makeApp(),
            '/preview/https://unknown-platform.dev/x',
            BROWSER_UA,
        );
        expect(preview.status).toBe(200);
        const html = await preview.text();
        expect(html).toContain('No adapter matched');
        expect(html).toContain('https://unknown-platform.dev/x');
        expect(html).not.toContain('http-equiv="refresh"'); // preview never auto-redirects
    });

    test('garbage path is 400 with hint, never 500', async () => {
        const res = await get(makeApp(), '/favicon.ico', BROWSER_UA);
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('fixem.be');
    });

    test('oembed returns author/provider for matched URL', async () => {
        const res = await get(
            makeApp(),
            `/oembed?url=${encodeURIComponent('https://example.com/hello')}`,
            DISCORD_UA,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.provider_name).toBe('example.com');
        expect(body.version).toBe('1.0');
    });

    test('oembed 404s for unknown or missing url', async () => {
        expect(
            (
                await get(
                    makeApp(),
                    '/oembed?url=https://unknown.dev/x',
                    DISCORD_UA,
                )
            ).status,
        ).toBe(404);
        expect((await get(makeApp(), '/oembed', DISCORD_UA)).status).toBe(404);
    });

    const API_KEY = 'test-status-key';
    const apiCfg = () => loadConfig({STATUS_API_KEY: API_KEY});
    const apiGet = (
        app: ReturnType<typeof makeApp>,
        path: string,
        key: string | null = API_KEY,
    ) =>
        app.request(path, {
            headers: {
                'User-Agent': BROWSER_UA,
                ...(key === null ? {} : {'X-Api-Key': key}),
            },
        });

    test('GET /api/status/adapter reports media JSON for a matched URL', async () => {
        const res = await apiGet(
            makeApp({config: apiCfg()}),
            `/api/status/adapter?url=${encodeURIComponent('https://example.com/hello')}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.platform).toBe('dummy');
        expect(body.status).toBe('ok');
        expect(body.kind).toBe('image');
        expect(body.hasMedia).toBe(true);
    });

    test('GET /api/status/adapter reports no-adapter for an unmatched URL', async () => {
        const res = await apiGet(
            makeApp({config: apiCfg()}),
            `/api/status/adapter?url=${encodeURIComponent('https://unknown-platform.dev/x')}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('no-adapter');
        expect(body.hasMedia).toBe(false);
    });

    test('GET /api/status/adapter reports degraded (no media) when the adapter fails', async () => {
        const failing = {
            name: 'broken',
            match: (u: URL) => u.hostname === 'broken.test',
            canonicalize: (u: URL) => `https://broken.test${u.pathname}`,
            resolve: async () => {
                throw new Error('scraper died');
            },
        };
        const resolver = new Resolver({
            registry: new AdapterRegistry([failing]),
            cache: new MemoryCache(),
            logger: createLogger({write: () => {}}),
            ttlSeconds: 60,
            timeoutMs: 100,
        });
        const res = await apiGet(
            makeApp({config: apiCfg(), resolver}),
            `/api/status/adapter?url=${encodeURIComponent('https://broken.test/post/1')}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.platform).toBe('broken');
        expect(body.status).toBe('degraded');
        expect(body.hasMedia).toBe(false);
    });

    test('GET /api/status/adapter 400s for a missing url', async () => {
        const res = await apiGet(
            makeApp({config: apiCfg()}),
            '/api/status/adapter',
        );
        expect(res.status).toBe(400);
    });

    test('/api/* requires a valid X-Api-Key', async () => {
        const app = makeApp({config: apiCfg()});
        const path = `/api/status/adapter?url=${encodeURIComponent('https://example.com/hello')}`;
        expect((await apiGet(app, path, null)).status).toBe(401); // missing
        expect((await apiGet(app, path, 'wrong-key')).status).toBe(401); // wrong
        expect((await apiGet(app, path, API_KEY)).status).toBe(200); // valid
    });

    test('/api/* is closed (404) when STATUS_API_KEY is not configured', async () => {
        // default makeApp() sets no STATUS_API_KEY → the API surface is disabled.
        const path = `/api/status/adapter?url=${encodeURIComponent('https://example.com/hello')}`;
        expect((await apiGet(makeApp(), path, API_KEY)).status).toBe(404);
        expect((await apiGet(makeApp(), path, null)).status).toBe(404);
    });

    test('browser requests are rate limited, crawlers exempt', async () => {
        const config = loadConfig({RATE_LIMIT_PER_MIN: '2'});
        const app = makeApp({config});
        const path = '/https://example.com/hello';
        expect((await get(app, path, BROWSER_UA)).status).toBe(302);
        expect((await get(app, path, BROWSER_UA)).status).toBe(302);
        expect((await get(app, path, BROWSER_UA)).status).toBe(429);
        expect((await get(app, path, DISCORD_UA)).status).toBe(200); // crawler unaffected
    });

    test('oembed is rate limited for browsers, crawlers exempt', async () => {
        const config = loadConfig({RATE_LIMIT_PER_MIN: '1'});
        const app = makeApp({config});
        const path = '/oembed?url=https%3A%2F%2Fexample.com%2Fhello';
        expect((await get(app, path, BROWSER_UA)).status).toBe(200);
        expect((await get(app, path, BROWSER_UA)).status).toBe(429);
        expect((await get(app, path, DISCORD_UA)).status).toBe(200); // crawler unaffected
    });

    test('/preview/ is rate limited like a browser', async () => {
        const config = loadConfig({RATE_LIMIT_PER_MIN: '1'});
        const app = makeApp({config});
        const path = '/preview/https://example.com/hello';
        expect((await get(app, path, BROWSER_UA)).status).toBe(200);
        expect((await get(app, path, BROWSER_UA)).status).toBe(429);
    });

    test('legacy ?fixem=preview no longer triggers the diagnostic (plain 302)', async () => {
        const res = await get(
            makeApp(),
            '/https://example.com/hello?fixem=preview',
            BROWSER_UA,
        );
        expect(res.status).toBe(302);
        // fixem is our reserved param and is stripped, never leaked to the target.
        expect(res.headers.get('Location')).toBe('https://example.com/hello');
    });

    test('degraded resolve serves minimal embed to crawler', async () => {
        const _config = loadConfig({});
        const logger = createLogger({write: () => {}});
        const cache = new MemoryCache();
        const failing = {
            name: 'broken',
            match: (u: URL) => u.hostname === 'broken.test',
            canonicalize: (u: URL) => `https://broken.test${u.pathname}`,
            resolve: async () => {
                throw new Error('scraper died');
            },
        };
        const resolver = new Resolver({
            registry: new AdapterRegistry([failing]),
            cache,
            logger,
            ttlSeconds: 60,
            timeoutMs: 100,
        });
        const app = makeApp({resolver});
        const res = await get(app, '/https://broken.test/post/1', DISCORD_UA);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(
            'content="https://broken.test/post/1"',
        );
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    test('degraded resolve under /preview/ reports the degrade reason', async () => {
        const failing = {
            name: 'broken',
            match: (u: URL) => u.hostname === 'broken.test',
            canonicalize: (u: URL) => `https://broken.test${u.pathname}`,
            resolve: async () => {
                throw new Error('scraper died');
            },
        };
        const resolver = new Resolver({
            registry: new AdapterRegistry([failing]),
            cache: new MemoryCache(),
            logger: createLogger({write: () => {}}),
            ttlSeconds: 60,
            timeoutMs: 100,
        });
        const app = makeApp({resolver});
        const res = await get(
            app,
            '/preview/https://broken.test/post/1',
            BROWSER_UA,
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('broken'); // platform
        expect(html).toContain('degraded'); // status with reason
    });

    test('a well-formed URL never 500s even if the handler itself throws (onError guard)', async () => {
        // resolve() is guaranteed never to throw, so to reach the app-level onError
        // last-resort guard we inject a resolver that does throw. The invariant:
        // a well-formed wrapped URL degrades to a 302, never a 500.
        const throwingResolver = {
            canonicalFor: () => null,
            resolve: async () => {
                throw new Error('boom');
            },
        } as unknown as Resolver;
        const app = makeApp({resolver: throwingResolver});
        const res = await get(app, '/https://example.com/hello', DISCORD_UA);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('https://example.com/hello');
    });
});

test('reddit URL routes through app with fixture-backed adapter', async () => {
    const {createRedditAdapter} = await import('../src/adapters/reddit');
    const imagePost = (await import('./fixtures/reddit/image-post.json'))
        .default;
    // With credentials the adapter uses the OAuth JSON path; serve the token then
    // the fixture. (The credential-less path scrapes old.reddit HTML instead.)
    const fetchFn = (async (input: unknown) => {
        if (String(input).includes('access_token')) {
            return new Response(
                JSON.stringify({access_token: 'tok', expires_in: 3600}),
            );
        }
        return new Response(JSON.stringify(imagePost));
    }) as unknown as typeof fetch;
    const _config = loadConfig({});
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const resolver = new Resolver({
        registry: new AdapterRegistry([
            createRedditAdapter(fetchFn, {clientId: 'id', clientSecret: 'sec'}),
        ]),
        cache,
        logger,
        ttlSeconds: 60,
        timeoutMs: 1000,
    });
    const app = makeApp({resolver});
    const res = await get(
        app,
        '/https://old.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/?utm=1',
        DISCORD_UA,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('A sunset over the sea');
    expect(html).toContain('Reddit • r/pics');
    // browser hits canonical
    const red = await get(
        app,
        '/https://old.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea/',
        BROWSER_UA,
    );
    expect(red.headers.get('Location')).toBe(
        'https://www.reddit.com/r/pics/comments/abc123/a_sunset_over_the_sea',
    );
});

test('tiktok URL routes through the full app with a fixture-backed adapter', async () => {
    const {createTiktokAdapter, TIKTOK_DEFAULTS} = await import(
        '../src/adapters/tiktok'
    );
    const fixture = (await import('./fixtures/tiktok/universal-video.json'))
        .default;
    // TikTok ships the post JSON inside a <script> tag in the page HTML.
    const page =
        `<!doctype html><html><body>` +
        `<script id="${TIKTOK_DEFAULTS.rehydrationScriptId}" type="application/json">${JSON.stringify(fixture)}</script>` +
        `</body></html>`;
    const fetchFn = (async () =>
        new Response(page, {status: 200})) as unknown as typeof fetch;
    const config = loadConfig({
        PROXY_SECRET: 's',
        PUBLIC_BASE_URL: 'https://fixem.be',
    });
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const resolver = new Resolver({
        registry: new AdapterRegistry([createTiktokAdapter(fetchFn)]),
        cache,
        logger,
        ttlSeconds: 60,
        timeoutMs: 1000,
    });
    const app = makeApp({config, resolver});
    const res = await get(
        app,
        '/https://www.tiktok.com/@janetravels/video/7311234567890123456',
        DISCORD_UA,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Jane Traveler (@janetravels)');
    expect(html).toContain('TikTok');
    // inline video is wrapped in the signed /v/ proxy; raw CDN URL never exposed
    const m = html.match(/og:video" content="([^"]+)"/);
    expect(m?.[1]).toStartWith('https://fixem.be/v/');
    expect(html).not.toContain('v16-webapp.tiktokcdn.com');
});

test('proxied video is rewritten to a signed /v/ URL', async () => {
    const config = loadConfig({
        PROXY_SECRET: 's',
        PUBLIC_BASE_URL: 'https://fixem.be',
    });
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const proxAdapter = {
        name: 'prox',
        match: (u: URL) => u.hostname === 'prox.test',
        canonicalize: (u: URL) => `https://prox.test${u.pathname}`,
        resolve: async () => ({
            kind: 'video' as const,
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
    const resolver = new Resolver({
        registry: new AdapterRegistry([proxAdapter]),
        cache,
        logger,
        ttlSeconds: 60,
        timeoutMs: 1000,
    });
    const app = makeApp({config, resolver});
    const res = await get(app, '/https://prox.test/1', DISCORD_UA);
    const html = await res.text();
    const m = html.match(/og:video" content="([^"]+)"/);
    expect(m?.[1]).toStartWith('https://fixem.be/v/');
    expect(html).not.toContain('v16.tiktokcdn.com'); // raw CDN URL never exposed
});

test('proxy-required video drops to link when PROXY_SECRET unset', async () => {
    const config = loadConfig({}); // no PROXY_SECRET
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const proxAdapter = {
        name: 'prox',
        match: (u: URL) => u.hostname === 'prox.test',
        canonicalize: (u: URL) => `https://prox.test${u.pathname}`,
        resolve: async () => ({
            kind: 'video' as const,
            title: 'vid',
            siteName: 'Prox',
            originalUrl: 'https://prox.test/1',
            video: {
                url: 'https://v16.tiktokcdn.com/a.mp4',
                mimeType: 'video/mp4',
                proxyHeaders: {Referer: 'x'},
            },
        }),
    };
    const resolver = new Resolver({
        registry: new AdapterRegistry([proxAdapter]),
        cache,
        logger,
        ttlSeconds: 60,
        timeoutMs: 1000,
    });
    const res = await get(
        makeApp({config, resolver}),
        '/https://prox.test/1',
        DISCORD_UA,
    );
    const html = await res.text();
    expect(html).not.toContain('og:video');
    expect(html).not.toContain('tiktokcdn');
});

test('proxy-required video on a non-allowlisted host drops to link (not a 403 player)', async () => {
    const config = loadConfig({
        PROXY_SECRET: 's',
        PUBLIC_BASE_URL: 'https://fixem.be',
    });
    const logger = createLogger({write: () => {}});
    const cache = new MemoryCache();
    const proxAdapter = {
        name: 'prox',
        match: (u: URL) => u.hostname === 'prox.test',
        canonicalize: (u: URL) => `https://prox.test${u.pathname}`,
        resolve: async () => ({
            kind: 'video' as const,
            title: 'vid',
            siteName: 'Prox',
            originalUrl: 'https://prox.test/1',
            // host NOT on the proxy allowlist — a minted token would 403 at /v/
            video: {
                url: 'https://sketchy-cdn.example/a.mp4',
                mimeType: 'video/mp4',
                proxyHeaders: {Referer: 'x'},
            },
        }),
    };
    const resolver = new Resolver({
        registry: new AdapterRegistry([proxAdapter]),
        cache,
        logger,
        ttlSeconds: 60,
        timeoutMs: 1000,
    });
    const res = await get(
        makeApp({config, resolver}),
        '/https://prox.test/1',
        DISCORD_UA,
    );
    const html = await res.text();
    expect(html).not.toContain('og:video');
    expect(html).not.toContain('sketchy-cdn.example');
});
