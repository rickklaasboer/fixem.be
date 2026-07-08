import {describe, expect, test} from 'bun:test';
import type {RedisClient} from 'bun';
import {
    clientIp,
    MemoryRateLimitStore,
    RedisRateLimitStore,
} from '../src/lib/rate-limit';

describe('MemoryRateLimitStore', () => {
    test('counts hits within window, expires old ones', async () => {
        const s = new MemoryRateLimitStore();
        const w = 60_000;
        expect(await s.hit('ip1', w, 1_000)).toBe(1);
        expect(await s.hit('ip1', w, 2_000)).toBe(2);
        expect(await s.hit('ip2', w, 2_000)).toBe(1); // separate key
        // 61s later: first two hits fell out of the window
        expect(await s.hit('ip1', w, 62_500)).toBe(1);
    });
});

describe('RedisRateLimitStore fail-open', () => {
    test('hit returns 0 (never rate-limits) when Redis is unreachable', async () => {
        // 0 hits < any positive limit → the caller lets the request through, so a
        // Redis outage disables rate limiting rather than blocking traffic.
        const downClient = {
            send: async () => {
                throw new Error('redis down');
            },
        } as unknown as RedisClient;
        expect(
            await new RedisRateLimitStore(downClient).hit('ip1', 60_000, 1_000),
        ).toBe(0);
    });
});

describe('clientIp', () => {
    test('prefers CF-Connecting-IP, then X-Forwarded-For, then unknown', () => {
        expect(
            clientIp(
                new Headers({
                    'CF-Connecting-IP': '1.2.3.4',
                    'X-Forwarded-For': '9.9.9.9',
                }),
            ),
        ).toBe('1.2.3.4');
        expect(
            clientIp(new Headers({'X-Forwarded-For': '5.6.7.8, 10.0.0.1'})),
        ).toBe('5.6.7.8');
        expect(clientIp(new Headers())).toBe('unknown');
    });
});
