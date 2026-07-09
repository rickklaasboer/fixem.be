import {describe, expect, test} from 'bun:test';
import RedditConfig from '@/config/RedditConfig';
import TwitchConfig from '@/config/TwitchConfig';
import TwitterConfig from '@/config/TwitterConfig';
import ThreadsConfig from '@/config/ThreadsConfig';
import TiktokConfig from '@/config/TiktokConfig';
import InstagramConfig from '@/config/InstagramConfig';
import {
    INSTAGRAM_DEFAULTS,
    SYNDICATION_FEATURES,
    THREADS_DEFAULTS,
    TIKTOK_DEFAULTS,
    TWITCH_GQL_DEFAULTS,
} from '@/config/defaults';

describe('RedditConfig', () => {
    test('optional fields: unset/blank → undefined, set → passed through', () => {
        const d = RedditConfig.fromEnv({});
        expect(d.clientId).toBeUndefined();
        expect(d.proxyUrl).toBeUndefined();
        expect(
            RedditConfig.fromEnv({REDDIT_PROXY_URL: ''}).proxyUrl,
        ).toBeUndefined();
        const c = RedditConfig.fromEnv({
            REDDIT_CLIENT_ID: 'rid',
            REDDIT_CLIENT_SECRET: 'rsecret',
            REDDIT_HTTP_PROXY: 'http://u:p@gw.test:823',
        });
        expect(c.clientId).toBe('rid');
        expect(c.clientSecret).toBe('rsecret');
        expect(c.httpProxy).toBe('http://u:p@gw.test:823');
    });
});

describe('TwitchConfig', () => {
    test('gql defaults, blank falls back, enabled gate', () => {
        const d = TwitchConfig.fromEnv({});
        expect(d.gqlClientId).toBe(TWITCH_GQL_DEFAULTS.clientId);
        expect(d.gqlClipHash.length).toBe(64);
        expect(d.enabled).toBe(false);
        const blank = TwitchConfig.fromEnv({
            TWITCH_GQL_CLIENT_ID: '',
            TWITCH_GQL_CLIP_HASH: '',
        });
        expect(blank.gqlClientId).toBe(TWITCH_GQL_DEFAULTS.clientId);
        const on = TwitchConfig.fromEnv({
            TWITCH_CLIENT_ID: 'a',
            TWITCH_CLIENT_SECRET: 'b',
        });
        expect(on.enabled).toBe(true);
    });
});

describe('TwitterConfig', () => {
    test('syndication default, blank falls back, override honored', () => {
        expect(TwitterConfig.fromEnv({}).syndicationFeatures).toBe(
            SYNDICATION_FEATURES,
        );
        expect(
            TwitterConfig.fromEnv({TWITTER_SYNDICATION_FEATURES: ''})
                .syndicationFeatures,
        ).toBe(SYNDICATION_FEATURES);
        expect(
            TwitterConfig.fromEnv({
                TWITTER_SYNDICATION_FEATURES: 'tfw_custom:on',
            }).syndicationFeatures,
        ).toBe('tfw_custom:on');
    });
});

describe('Threads/Tiktok/Instagram config', () => {
    test('pinned defaults, blank fallbacks, overrides', () => {
        expect(ThreadsConfig.fromEnv({}).docId).toBe(THREADS_DEFAULTS.docId);
        expect(ThreadsConfig.fromEnv({THREADS_LSD: ''}).lsd).toBe(
            THREADS_DEFAULTS.lsd,
        );
        expect(ThreadsConfig.fromEnv({THREADS_DOC_ID: 'custom-doc'}).docId).toBe(
            'custom-doc',
        );
        expect(TiktokConfig.fromEnv({}).deviceId).toBe(TIKTOK_DEFAULTS.deviceId);
        expect(
            TiktokConfig.fromEnv({TIKTOK_REHYDRATION_SCRIPT_ID: '__CUSTOM__'})
                .rehydrationScriptId,
        ).toBe('__CUSTOM__');
        const ig = InstagramConfig.fromEnv({});
        expect(ig.docId).toBe(INSTAGRAM_DEFAULTS.docId);
        expect(ig.proxyUrl).toBeUndefined();
        expect(ig.snapsave).toBe(false);
        expect(InstagramConfig.fromEnv({INSTAGRAM_SNAPSAVE: '1'}).snapsave).toBe(
            true,
        );
        expect(InstagramConfig.fromEnv({INSTAGRAM_APP_ID: ''}).appId).toBe(
            INSTAGRAM_DEFAULTS.appId,
        );
    });
});
