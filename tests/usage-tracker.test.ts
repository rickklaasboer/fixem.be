import {describe, expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import Logger from '@/services/Logger';
import Clock from '@/services/Clock';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';

const silent = () => new Logger({write: () => {}});
const clockAt = (ms: number) => ({now: () => ms}) as unknown as Clock;
// 2026-07-11T12:00:00Z
const T = Date.UTC(2026, 6, 11, 12, 0, 0);

describe('UsageTracker', () => {
    test('buffers records without writing until flush, bucketed by UTC day', () => {
        const store = new MetricsStore(new Database(':memory:'), silent());
        const t = new UsageTracker(store, clockAt(T), silent());

        t.recordResolve({
            platform: 'reddit',
            outcome: 'ok',
            cache: 'miss',
            uaClass: 'crawler',
        });
        t.recordResolve({
            platform: 'reddit',
            outcome: 'ok',
            cache: 'miss',
            uaClass: 'crawler',
        });
        t.recordApiKey('hash1');
        t.recordProxyBytes('tiktok', 1000);

        // Nothing written yet.
        expect(store.usageBetween('2026-07-01', '2026-07-31')).toEqual([]);

        t.flush();
        expect(store.usageBetween('2026-07-01', '2026-07-31')).toEqual([
            {
                day: '2026-07-11',
                platform: 'reddit',
                outcome: 'ok',
                cache: 'miss',
                uaClass: 'crawler',
                count: 2,
            },
        ]);
        expect(store.apiKeysBetween('2026-07-01', '2026-07-31')).toEqual([
            {day: '2026-07-11', keyId: 'hash1', count: 1},
        ]);
        expect(store.proxyBytesBetween('2026-07-01', '2026-07-31')).toEqual([
            {day: '2026-07-11', platform: 'tiktok', bytes: 1000, requests: 1},
        ]);
    });

    test('flush clears the buffer (a second flush writes nothing new)', () => {
        const store = new MetricsStore(new Database(':memory:'), silent());
        const t = new UsageTracker(store, clockAt(T), silent());
        t.recordApiKey('k');
        t.flush();
        t.flush(); // buffer empty now
        expect(store.apiKeysBetween('2026-07-01', '2026-07-31')).toEqual([
            {day: '2026-07-11', keyId: 'k', count: 1},
        ]);
    });

    test('recordOutcome maps resolver outcomes', () => {
        const store = new MetricsStore(new Database(':memory:'), silent());
        const t = new UsageTracker(store, clockAt(T), silent());
        t.recordOutcome(
            {
                status: 'ok',
                meta: {} as never,
                canonicalUrl: 'x',
                platform: 'reddit',
                cacheHit: true,
            },
            'api',
        );
        t.recordOutcome({status: 'no-adapter'}, 'api');
        t.recordOutcome(
            {
                status: 'degraded',
                canonicalUrl: 'x',
                platform: 'threads',
                reason: 'timeout',
            },
            'crawler',
        );
        t.flush();
        const rows = store.usageBetween('2026-07-01', '2026-07-31');
        expect(rows).toContainEqual({
            day: '2026-07-11',
            platform: 'reddit',
            outcome: 'ok',
            cache: 'hit',
            uaClass: 'api',
            count: 1,
        });
        expect(rows).toContainEqual({
            day: '2026-07-11',
            platform: 'none',
            outcome: 'no-adapter',
            cache: 'n/a',
            uaClass: 'api',
            count: 1,
        });
        expect(rows).toContainEqual({
            day: '2026-07-11',
            platform: 'threads',
            outcome: 'degraded',
            cache: 'n/a',
            uaClass: 'crawler',
            count: 1,
        });
    });

    test('flush error retains counts for retry (merge-back), no double count', () => {
        // Store whose flush throws once, then succeeds.
        let calls = 0;
        const real = new MetricsStore(new Database(':memory:'), silent());
        const flaky = {
            flush(batch: Parameters<MetricsStore['flush']>[0]) {
                calls++;
                if (calls === 1) throw new Error('disk full');
                real.flush(batch);
            },
            usageBetween: (a: string, b: string) => real.usageBetween(a, b),
        } as unknown as MetricsStore;
        const t = new UsageTracker(flaky, clockAt(T), silent());
        t.recordResolve({
            platform: 'x',
            outcome: 'ok',
            cache: 'hit',
            uaClass: 'api',
        });
        t.flush(); // throws internally, merged back
        t.flush(); // succeeds
        expect(real.usageBetween('2026-07-01', '2026-07-31')).toEqual([
            {
                day: '2026-07-11',
                platform: 'x',
                outcome: 'ok',
                cache: 'hit',
                uaClass: 'api',
                count: 1,
            },
        ]);
    });

    test('degraded store (null db) silently drops — record + flush never throw', () => {
        const t = new UsageTracker(
            new MetricsStore(null, silent()),
            clockAt(T),
            silent(),
        );
        expect(() => {
            t.recordResolve({
                platform: 'x',
                outcome: 'ok',
                cache: 'hit',
                uaClass: 'api',
            });
            t.flush();
        }).not.toThrow();
    });
});
