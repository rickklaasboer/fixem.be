import {describe, expect, test} from 'bun:test';
import {loadConfig} from '@/config/Config';
import {
    INSTAGRAM_DEFAULTS,
    SYNDICATION_FEATURES,
    THREADS_DEFAULTS,
    TIKTOK_DEFAULTS,
    TWITCH_GQL_DEFAULTS,
} from '@/config/defaults';

describe('loadConfig', () => {
    test('applies defaults for empty env', () => {
        const c = loadConfig({});
        expect(c.port).toBe(3000);
        expect(c.redisUrl).toBe('redis://localhost:6379');
        expect(c.cacheTtlSeconds).toBe(14400);
        expect(c.resolveTimeoutMs).toBe(5000);
        expect(c.rateLimitPerMin).toBe(60);
        expect(c.publicBaseUrl).toBe('https://fixem.be');
        expect(c.extraCrawlerUas).toEqual([]);
        expect(c.twitchGqlClientId).toBe(TWITCH_GQL_DEFAULTS.clientId);
        expect(c.twitchGqlClipHash).toBe(TWITCH_GQL_DEFAULTS.clipTokenHash);
    });

    test('reads overrides and parses extra UAs', () => {
        const c = loadConfig({
            PORT: '8080',
            CACHE_TTL_SECONDS: '60',
            EXTRA_CRAWLER_UAS: 'MyBot, OtherBot',
            TWITCH_CLIENT_ID: 'abc',
            REDDIT_CLIENT_ID: 'rid',
            REDDIT_CLIENT_SECRET: 'rsecret',
        });
        expect(c.port).toBe(8080);
        expect(c.cacheTtlSeconds).toBe(60);
        expect(c.extraCrawlerUas).toEqual(['mybot', 'otherbot']);
        expect(c.twitchClientId).toBe('abc');
        expect(c.redditClientId).toBe('rid');
        expect(c.redditClientSecret).toBe('rsecret');
    });

    test('blank Twitter syndication features fall back to the pinned default', () => {
        // A copied .env.example leaves TWITTER_SYNDICATION_FEATURES as "" — that
        // must not reach the adapter as a blank feature string.
        expect(loadConfig({}).twitterSyndicationFeatures).toBe(
            SYNDICATION_FEATURES,
        );
        const c = loadConfig({TWITTER_SYNDICATION_FEATURES: ''});
        expect(c.twitterSyndicationFeatures).toBe(SYNDICATION_FEATURES);
        expect(c.twitterSyndicationFeatures.length).toBeGreaterThan(0);
        expect(c.twitterSyndicationFeatures).toContain('tfw_');
    });

    test('Twitter syndication features honor an env override', () => {
        const c = loadConfig({TWITTER_SYNDICATION_FEATURES: 'tfw_custom:on'});
        expect(c.twitterSyndicationFeatures).toBe('tfw_custom:on');
    });

    test('blank GQL overrides fall back to pinned defaults', () => {
        // `cp .env.example .env` leaves TWITCH_GQL_* as empty strings — those must
        // not reach the adapter as a blank Client-ID.
        const c = loadConfig({
            TWITCH_GQL_CLIENT_ID: '',
            TWITCH_GQL_CLIP_HASH: '',
        });
        expect(c.twitchGqlClientId).toBe('kimne78kx3ncx6brgo4mv6wki5h1ko');
        expect(c.twitchGqlClipHash.length).toBe(64);
    });

    test('Threads/TikTok/Instagram adapter constants default to the pinned values', () => {
        const c = loadConfig({});
        // one default-sanity assertion per new platform
        expect(c.threads.docId).toBe(THREADS_DEFAULTS.docId);
        expect(c.tiktok.deviceId).toBe(TIKTOK_DEFAULTS.deviceId);
        expect(c.tiktok.rehydrationScriptId).toBe(
            TIKTOK_DEFAULTS.rehydrationScriptId,
        );
        expect(c.instagram.docId).toBe(INSTAGRAM_DEFAULTS.docId);
        expect(c.instagram.proxyUrl).toBeUndefined();
    });

    test('blank adapter-constant overrides fall back to pinned defaults', () => {
        // `cp .env.example .env` leaves these as empty strings — must not reach the
        // adapters as blank constants.
        const c = loadConfig({
            THREADS_LSD: '',
            TIKTOK_IID: '',
            INSTAGRAM_APP_ID: '',
        });
        expect(c.threads.lsd).toBe(THREADS_DEFAULTS.lsd);
        expect(c.tiktok.iid).toBe(TIKTOK_DEFAULTS.iid);
        expect(c.instagram.appId).toBe(INSTAGRAM_DEFAULTS.appId);
    });

    test('adapter constants honor env overrides', () => {
        const c = loadConfig({
            THREADS_DOC_ID: 'custom-doc',
            INSTAGRAM_PROXY_URL: 'https://proxy.test/?u=',
        });
        expect(c.threads.docId).toBe('custom-doc');
        expect(c.instagram.proxyUrl).toBe('https://proxy.test/?u=');
    });

    test('REDDIT_PROXY_URL is optional: unset/blank → undefined, set → passed through', () => {
        expect(loadConfig({}).redditProxyUrl).toBeUndefined();
        expect(
            loadConfig({REDDIT_PROXY_URL: ''}).redditProxyUrl,
        ).toBeUndefined();
        expect(
            loadConfig({REDDIT_PROXY_URL: 'https://proxy.test/?u='})
                .redditProxyUrl,
        ).toBe('https://proxy.test/?u=');
    });

    test('REDDIT_HTTP_PROXY is optional: unset/blank → undefined, set → passed through', () => {
        expect(loadConfig({}).redditHttpProxy).toBeUndefined();
        expect(
            loadConfig({REDDIT_HTTP_PROXY: ''}).redditHttpProxy,
        ).toBeUndefined();
        expect(
            loadConfig({REDDIT_HTTP_PROXY: 'http://u:p@gw.test:823'})
                .redditHttpProxy,
        ).toBe('http://u:p@gw.test:823');
    });

    test('TIKTOK_REHYDRATION_SCRIPT_ID is overridable, blank falls back', () => {
        expect(
            loadConfig({TIKTOK_REHYDRATION_SCRIPT_ID: '__CUSTOM__'}).tiktok
                .rehydrationScriptId,
        ).toBe('__CUSTOM__');
        expect(
            loadConfig({TIKTOK_REHYDRATION_SCRIPT_ID: ''}).tiktok
                .rehydrationScriptId,
        ).toBe(TIKTOK_DEFAULTS.rehydrationScriptId);
    });

    test('default proxy allowlist covers the EU TikTok CDN family', () => {
        const c = loadConfig({});
        expect(c.proxyHostAllowlist).toContain('tiktokcdn-eu.com');
    });

    test('parses API_KEYS as a trimmed, empty-filtered list; defaults to []', () => {
        expect(loadConfig({}).apiKeys).toEqual([]);
        expect(loadConfig({API_KEYS: ''}).apiKeys).toEqual([]);
        expect(loadConfig({API_KEYS: 'k1, k2 ,,k3'}).apiKeys).toEqual([
            'k1',
            'k2',
            'k3',
        ]);
    });

    test('API rate limit and batch bound default and honor overrides', () => {
        const d = loadConfig({});
        expect(d.apiRateLimitPerMin).toBe(60);
        expect(d.batchMaxUrls).toBe(20);
        const o = loadConfig({
            API_RATE_LIMIT_PER_MIN: '120',
            BATCH_MAX_URLS: '5',
        });
        expect(o.apiRateLimitPerMin).toBe(120);
        expect(o.batchMaxUrls).toBe(5);
        // below-floor values fall back (intMin), matching the other numeric knobs
        expect(loadConfig({API_RATE_LIMIT_PER_MIN: '0'}).apiRateLimitPerMin).toBe(
            60,
        );
        expect(loadConfig({BATCH_MAX_URLS: '-3'}).batchMaxUrls).toBe(20);
    });

    test('falls back to default on non-numeric value', () => {
        expect(loadConfig({PORT: 'banana'}).port).toBe(3000);
    });

    test('falls back to default on values below the sane floor', () => {
        expect(loadConfig({RATE_LIMIT_PER_MIN: '-1'}).rateLimitPerMin).toBe(60);
        expect(loadConfig({RESOLVE_TIMEOUT_MS: '0'}).resolveTimeoutMs).toBe(
            5000,
        );
    });
});
