import {describe, expect, test} from 'bun:test';
import AppConfig from '@/config/AppConfig';
import RedisConfig from '@/config/RedisConfig';
import ResolverConfig from '@/config/ResolverConfig';
import RateLimitConfig from '@/config/RateLimitConfig';
import ApiConfig from '@/config/ApiConfig';
import ProxyConfig from '@/config/ProxyConfig';

describe('AppConfig', () => {
    test('defaults + parsing', () => {
        const d = AppConfig.fromEnv({});
        expect(d.port).toBe(3000);
        expect(d.publicBaseUrl).toBe('https://fixem.be');
        expect(d.extraCrawlerUas).toEqual([]);
        const c = AppConfig.fromEnv({
            PORT: '8080',
            EXTRA_CRAWLER_UAS: 'MyBot, OtherBot',
        });
        expect(c.port).toBe(8080);
        expect(c.extraCrawlerUas).toEqual(['mybot', 'otherbot']);
    });
    test('non-numeric / sub-floor PORT falls back', () => {
        expect(AppConfig.fromEnv({PORT: 'banana'}).port).toBe(3000);
    });
});

describe('RedisConfig', () => {
    test('default; blank falls back (intentional fix)', () => {
        expect(RedisConfig.fromEnv({}).url).toBe('redis://localhost:6379');
        expect(RedisConfig.fromEnv({REDIS_URL: ''}).url).toBe(
            'redis://localhost:6379',
        );
        expect(RedisConfig.fromEnv({REDIS_URL: 'redis://h:6379'}).url).toBe(
            'redis://h:6379',
        );
    });
});

describe('ResolverConfig', () => {
    test('defaults + floor', () => {
        const d = ResolverConfig.fromEnv({});
        expect(d.resolveTimeoutMs).toBe(5000);
        expect(d.cacheTtlSeconds).toBe(14400);
        expect(
            ResolverConfig.fromEnv({RESOLVE_TIMEOUT_MS: '0'}).resolveTimeoutMs,
        ).toBe(5000);
    });
});

describe('RateLimitConfig', () => {
    test('default + floor', () => {
        expect(RateLimitConfig.fromEnv({}).perMin).toBe(60);
        expect(RateLimitConfig.fromEnv({RATE_LIMIT_PER_MIN: '-1'}).perMin).toBe(
            60,
        );
    });
});

describe('ApiConfig', () => {
    test('keys list, floors, defaults', () => {
        const d = ApiConfig.fromEnv({});
        expect(d.keys).toEqual([]);
        expect(d.rateLimitPerMin).toBe(60);
        expect(d.batchMaxUrls).toBe(20);
        const c = ApiConfig.fromEnv({
            API_KEYS: 'k1, k2 ,,k3',
            API_RATE_LIMIT_PER_MIN: '0',
            BATCH_MAX_URLS: '-3',
        });
        expect(c.keys).toEqual(['k1', 'k2', 'k3']);
        expect(c.rateLimitPerMin).toBe(60);
        expect(c.batchMaxUrls).toBe(20);
    });
});

describe('ProxyConfig', () => {
    test('defaults + allowlist + floors', () => {
        const d = ProxyConfig.fromEnv({});
        expect(d.secret).toBe('');
        expect(d.hostAllowlist).toContain('tiktokcdn-eu.com');
        expect(d.maxConcurrent).toBe(32);
        expect(d.maxBytes).toBe(104857600);
        expect(d.timeoutMs).toBe(10000);
        const c = ProxyConfig.fromEnv({
            PROXY_SECRET: 's',
            PROXY_HOST_ALLOWLIST: 'A.com, B.com',
        });
        expect(c.secret).toBe('s');
        expect(c.hostAllowlist).toEqual(['a.com', 'b.com']);
    });
});
