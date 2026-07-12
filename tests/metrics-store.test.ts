import {describe, expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import Logger from '@/services/Logger';
import MetricsStore from '@/services/metrics/MetricsStore';

const silent = () => new Logger({write: () => {}});
const store = () => new MetricsStore(new Database(':memory:'), silent());

describe('MetricsStore', () => {
    test('flush upserts and accumulates across calls', () => {
        const s = store();
        s.flush({
            usage: [
                {
                    day: '2026-07-11',
                    platform: 'reddit',
                    outcome: 'ok',
                    cache: 'miss',
                    uaClass: 'crawler',
                    count: 2,
                },
            ],
            apiKey: [{day: '2026-07-11', keyId: 'abc', count: 3}],
            proxyBytes: [
                {
                    day: '2026-07-11',
                    platform: 'tiktok',
                    bytes: 100,
                    requests: 1,
                },
            ],
        });
        // Second flush of the SAME keys must add, not replace.
        s.flush({
            usage: [
                {
                    day: '2026-07-11',
                    platform: 'reddit',
                    outcome: 'ok',
                    cache: 'miss',
                    uaClass: 'crawler',
                    count: 5,
                },
            ],
            apiKey: [{day: '2026-07-11', keyId: 'abc', count: 1}],
            proxyBytes: [
                {day: '2026-07-11', platform: 'tiktok', bytes: 50, requests: 1},
            ],
        });

        const u = s.usageBetween('2026-07-01', '2026-07-31');
        expect(u).toEqual([
            {
                day: '2026-07-11',
                platform: 'reddit',
                outcome: 'ok',
                cache: 'miss',
                uaClass: 'crawler',
                count: 7,
            },
        ]);
        expect(s.apiKeysBetween('2026-07-01', '2026-07-31')).toEqual([
            {day: '2026-07-11', keyId: 'abc', count: 4},
        ]);
        expect(s.proxyBytesBetween('2026-07-01', '2026-07-31')).toEqual([
            {day: '2026-07-11', platform: 'tiktok', bytes: 150, requests: 2},
        ]);
    });

    test('range query bounds are inclusive and exclude out-of-range days', () => {
        const s = store();
        const row = (day: string) => ({
            day,
            platform: 'x',
            outcome: 'ok',
            cache: 'hit',
            uaClass: 'api',
            count: 1,
        });
        s.flush({
            usage: [row('2026-07-09'), row('2026-07-10'), row('2026-07-11')],
            apiKey: [],
            proxyBytes: [],
        });
        const days = s
            .usageBetween('2026-07-10', '2026-07-11')
            .map((r) => r.day);
        expect(days).toEqual(['2026-07-10', '2026-07-11']);
    });

    test('null db is a no-op (fail-open): flush does not throw, queries empty', () => {
        const s = new MetricsStore(null, silent());
        expect(() =>
            s.flush({
                usage: [
                    {
                        day: '2026-07-11',
                        platform: 'x',
                        outcome: 'ok',
                        cache: 'hit',
                        uaClass: 'api',
                        count: 1,
                    },
                ],
                apiKey: [],
                proxyBytes: [],
            }),
        ).not.toThrow();
        expect(s.usageBetween('2026-07-01', '2026-07-31')).toEqual([]);
    });

    test('empty batch is a no-op', () => {
        const s = store();
        expect(() =>
            s.flush({usage: [], apiKey: [], proxyBytes: []}),
        ).not.toThrow();
        expect(s.usageBetween('2026-07-01', '2026-07-31')).toEqual([]);
    });
});
