import {describe, expect, test} from 'bun:test';
import Resolver from '@/domain/Resolver';
import AdapterRegistry from '@/domain/AdapterRegistry';
import MemoryCache from '@/services/cache/MemoryCache';
import Logger from '@/services/Logger';
import type Cache from '@/services/cache/Cache';
import type Clock from '@/services/Clock';
import type Config from '@/config/Config';
import type EmbedMetadata from '@/domain/EmbedMetadata';
import type PlatformAdapter from '@/domain/PlatformAdapter';

const META: EmbedMetadata = {
    kind: 'link',
    title: 't',
    siteName: 's',
    originalUrl: 'https://fake.test/p',
};

const silent = new Logger({write: () => {}});

function fakeAdapter(overrides: Partial<PlatformAdapter> = {}) {
    let calls = 0;
    const adapter: PlatformAdapter = {
        name: 'fake',
        match: (u) => u.hostname === 'fake.test',
        canonicalize: (u) => `https://fake.test${u.pathname}`,
        resolve: async () => {
            calls++;
            return META;
        },
        ...overrides,
    };
    return {adapter, calls: () => calls};
}

interface ResolverOverrides {
    cache?: Cache;
    ttlSeconds?: number;
    timeoutMs?: number;
    now?: () => number;
}

// Resolver's breaker knobs are internal constants: threshold 5, cooldown 60s.
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

function makeResolver(adapter: PlatformAdapter, opts: ResolverOverrides = {}) {
    const {
        cache = new MemoryCache(),
        ttlSeconds = 3600,
        timeoutMs = 200,
        now,
    } = opts;
    const clock = {now: now ?? Date.now} as Clock;
    const config = {
        cacheTtlSeconds: ttlSeconds,
        resolveTimeoutMs: timeoutMs,
    } as unknown as Config;
    const registry = new AdapterRegistry([adapter]);
    return new Resolver(registry, cache, silent, clock, config);
}

describe('Resolver', () => {
    test('no adapter → no-adapter', async () => {
        const {adapter} = fakeAdapter();
        const r = makeResolver(adapter);
        expect((await r.resolve(new URL('https://other.test/x'))).status).toBe(
            'no-adapter',
        );
        expect(r.canonicalFor(new URL('https://other.test/x'))).toBeNull();
    });

    test('ok resolve, then cache hit (adapter called once)', async () => {
        const {adapter, calls} = fakeAdapter();
        const r = makeResolver(adapter);
        const first = await r.resolve(new URL('https://fake.test/p'));
        expect(first.status).toBe('ok');
        if (first.status === 'ok') expect(first.cacheHit).toBe(false);
        const second = await r.resolve(new URL('https://fake.test/p'));
        if (second.status === 'ok') expect(second.cacheHit).toBe(true);
        expect(calls()).toBe(1);
    });

    test('concurrent resolves are deduplicated', async () => {
        let calls = 0;
        const {adapter} = fakeAdapter({
            resolve: async () => {
                calls++;
                await new Promise((r) => setTimeout(r, 30));
                return META;
            },
        });
        const r = makeResolver(adapter);
        const [a, b] = await Promise.all([
            r.resolve(new URL('https://fake.test/p')),
            r.resolve(new URL('https://fake.test/p')),
        ]);
        expect(a.status).toBe('ok');
        expect(b.status).toBe('ok');
        expect(calls).toBe(1);
    });

    test('slow adapter times out → degraded', async () => {
        const {adapter} = fakeAdapter({
            resolve: () => new Promise(() => {}), // never settles
        });
        const r = makeResolver(adapter, {timeoutMs: 20});
        const out = await r.resolve(new URL('https://fake.test/p'));
        expect(out.status).toBe('degraded');
        if (out.status === 'degraded') expect(out.reason).toBe('timeout');
    });

    test('aborts the resolve signal on timeout so adapters can cancel in-flight fetches', async () => {
        let captured: AbortSignal | undefined;
        const {adapter} = fakeAdapter({
            resolve: (_url, signal) =>
                new Promise(() => {
                    captured = signal; // adapter would thread this into fetch via withSignal
                }),
        });
        const r = makeResolver(adapter, {timeoutMs: 20});
        const out = await r.resolve(new URL('https://fake.test/p'));
        expect(out.status).toBe('degraded');
        expect(captured).toBeDefined();
        expect(captured?.aborted).toBe(true); // timeout fired → in-flight work is cancelled
    });

    test('breaker opens after threshold and skips adapter during cooldown', async () => {
        let calls = 0;
        let t = 1_000_000;
        const {adapter} = fakeAdapter({
            resolve: async () => {
                calls++;
                throw new Error('boom');
            },
        });
        const r = makeResolver(adapter, {now: () => t});
        for (let i = 0; i < BREAKER_THRESHOLD; i++) {
            await r.resolve(new URL('https://fake.test/p'));
        }
        expect(calls).toBe(BREAKER_THRESHOLD);
        const out = await r.resolve(new URL('https://fake.test/p'));
        expect(out.status).toBe('degraded');
        if (out.status === 'degraded') expect(out.reason).toBe('breaker-open');
        expect(calls).toBe(BREAKER_THRESHOLD); // adapter not called while open
        t += BREAKER_COOLDOWN_MS + 1; // cooldown elapsed → adapter tried again
        await r.resolve(new URL('https://fake.test/p'));
        expect(calls).toBe(BREAKER_THRESHOLD + 1);
    });

    test('cached entries are served even while breaker is open', async () => {
        let fail = false;
        const {adapter} = fakeAdapter({
            resolve: async () => {
                if (fail) throw new Error('boom');
                return META;
            },
        });
        const r = makeResolver(adapter);
        await r.resolve(new URL('https://fake.test/p')); // now cached
        fail = true;
        for (let i = 0; i < BREAKER_THRESHOLD; i++) {
            await r.resolve(new URL('https://fake.test/q')); // breaker opens
        }
        const hit = await r.resolve(new URL('https://fake.test/p'));
        expect(hit.status).toBe('ok');
        if (hit.status === 'ok') expect(hit.cacheHit).toBe(true);
        const miss = await r.resolve(new URL('https://fake.test/q'));
        expect(miss.status).toBe('degraded');
        if (miss.status === 'degraded')
            expect(miss.reason).toBe('breaker-open');
    });

    test('throwing canonicalize degrades instead of throwing', async () => {
        const {adapter} = fakeAdapter({
            canonicalize: () => {
                throw new Error('bad canonicalize');
            },
        });
        const r = makeResolver(adapter);
        const out = await r.resolve(new URL('https://fake.test/p'));
        expect(out.status).toBe('degraded');
        if (out.status === 'degraded') expect(out.reason).toBe('internal');
        expect(r.canonicalFor(new URL('https://fake.test/p'))).toBeNull();
    });

    test('meta ttlSeconds hint caps the cache TTL', async () => {
        const captured: number[] = [];
        const cache = new MemoryCache();
        const origSetEx = cache.setEx.bind(cache);
        cache.setEx = async (k, ttl, v) => {
            captured.push(ttl);
            return origSetEx(k, ttl, v);
        };
        const {adapter} = fakeAdapter({
            resolve: async () => ({...META, ttlSeconds: 60}),
        });
        const r = makeResolver(adapter, {cache, ttlSeconds: 3600});
        await r.resolve(new URL('https://fake.test/p'));
        expect(captured).toEqual([60]);
    });
});
