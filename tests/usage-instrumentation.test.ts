import {describe, expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import Logger from '@/services/Logger';
import Clock from '@/services/Clock';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';
import createTestApp from './support/createTestApp';

const silent = () => new Logger({write: () => {}});
const DISCORD_UA =
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const BROWSER_UA =
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

// A store + tracker the test holds references to, sharing one clock at a fixed day.
function harness() {
    const store = new MetricsStore(new Database(':memory:'), silent());
    const clock = {now: () => Date.UTC(2026, 6, 11, 12)} as unknown as Clock;
    const tracker = new UsageTracker(store, clock, silent());
    const app = createTestApp({
        metricsStore: store,
        usageTracker: tracker,
        now: clock.now,
    });
    return {store, tracker, app};
}

// Variant with API keys configured (customer auth) — shares tracker/store.
function harness2(keys: string[]) {
    const store = new MetricsStore(new Database(':memory:'), silent());
    const clock = {now: () => Date.UTC(2026, 6, 11, 12)} as unknown as Clock;
    const tracker = new UsageTracker(store, clock, silent());
    const app = createTestApp({
        metricsStore: store,
        usageTracker: tracker,
        now: clock.now,
        api: {keys},
    });
    return {store, tracker, app};
}

describe('resolve/redirect instrumentation', () => {
    test('crawler embed of example.com records an ok/miss/crawler row', async () => {
        const {store, tracker, app} = harness();
        await app.request('/https://example.com/hello', {
            headers: {'User-Agent': DISCORD_UA},
        });
        tracker.flush();
        expect(store.usageBetween('2026-07-11', '2026-07-11')).toContainEqual({
            day: '2026-07-11',
            platform: 'dummy',
            outcome: 'ok',
            cache: 'miss',
            uaClass: 'crawler',
            count: 1,
        });
    });

    test('browser hit records a redirect/n-a/browser row', async () => {
        const {store, tracker, app} = harness();
        await app.request('/https://example.com/hello', {
            headers: {'User-Agent': BROWSER_UA},
        });
        tracker.flush();
        expect(store.usageBetween('2026-07-11', '2026-07-11')).toContainEqual({
            day: '2026-07-11',
            platform: 'dummy',
            outcome: 'redirect',
            cache: 'n/a',
            uaClass: 'browser',
            count: 1,
        });
    });

    test('API v1 resolve records an ok/*/api row', async () => {
        const {store, tracker, app} = harness2(['cust']);
        await app.request('/api/v1/resolve?url=https://example.com/x', {
            headers: {Authorization: 'Bearer cust'},
        });
        tracker.flush();
        const rows = store.usageBetween('2026-07-11', '2026-07-11');
        expect(
            rows.some(
                (r) =>
                    r.uaClass === 'api' &&
                    r.platform === 'dummy' &&
                    r.outcome === 'ok',
            ),
        ).toBe(true);
    });
});
