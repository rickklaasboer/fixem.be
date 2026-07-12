import {describe, expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import type {Context} from 'hono';
import Logger from '@/services/Logger';
import type Clock from '@/services/Clock';
import ProxyConfig from '@/config/ProxyConfig';
import RateLimitConfig from '@/config/RateLimitConfig';
import HttpClient from '@/services/HttpClient';
import ProxySigner from '@/services/proxy/ProxySigner';
import ProxyStreamer from '@/services/proxy/ProxyStreamer';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';

const silent = () => new Logger({write: () => {}});
const clockAt = (ms: number) => ({now: () => ms}) as unknown as Clock;
const T = Date.UTC(2026, 6, 11, 12);

// Minimal fake fetch: 200 with a 5-byte body from an allowlisted host.
const mockFetch = async () =>
    new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        status: 200,
        headers: {'content-type': 'video/mp4', 'content-length': '5'},
    });

// Minimal Context stub for ProxyStreamer.stream: token param + no Range + IP header.
function ctx(token: string): Context {
    const headers = new Headers();
    return {
        req: {
            param: (k: string) => (k === 'token' ? token : undefined),
            header: (_k: string) => undefined,
            raw: {headers},
        },
        text: (body: string, status?: number) =>
            new Response(body, {status: status ?? 200}),
    } as unknown as Context;
}

describe('proxy bandwidth instrumentation', () => {
    test('records bytes streamed against the token platform', async () => {
        const store = new MetricsStore(new Database(':memory:'), silent());
        const tracker = new UsageTracker(store, clockAt(T), silent());
        const proxy = Object.assign(new ProxyConfig(), {
            secret: 'sek',
            hostAllowlist: ['video.twimg.com'],
            maxConcurrent: 32,
            maxBytes: 1000,
            timeoutMs: 1000,
        });
        const rl = Object.assign(new RateLimitConfig(), {perMin: 1000});
        const signer = new ProxySigner();
        const streamer = new ProxyStreamer(
            proxy,
            rl,
            silent(),
            {hit: async () => 1} as never, // rate-limit store stub
            clockAt(T),
            new HttpClient(mockFetch as never),
            signer,
            tracker,
        );
        const token = await signer.sign('sek', {
            url: 'https://video.twimg.com/x.mp4',
            headers: {},
            exp: T + 60_000,
            platform: 'twitter',
        });
        const res = await streamer.stream(ctx(token));
        // Drain the body so the stream reaches its end and onEnd fires.
        await res.text();
        tracker.flush();
        expect(store.proxyBytesBetween('2026-07-11', '2026-07-11')).toEqual([
            {day: '2026-07-11', platform: 'twitter', bytes: 5, requests: 1},
        ]);
    });
});
