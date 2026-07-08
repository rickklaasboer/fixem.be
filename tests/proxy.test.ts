import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';
import {mountProxy, isHostAllowed} from '../src/proxy';
import {loadConfig} from '../src/lib/config';
import {createLogger} from '../src/lib/logger';
import {MemoryRateLimitStore} from '../src/lib/rate-limit';
import {signProxyToken} from '../src/lib/proxy-sign';
import type {FetchFn} from '../src/adapters/types';

const SECRET = 's';
const silent = createLogger({write: () => {}});

async function appWith(
    fetchFn: FetchFn,
    overrides: Record<string, string> = {},
) {
    const config = loadConfig({PROXY_SECRET: SECRET, ...overrides});
    const app = new Hono();
    mountProxy(app, {config, logger: silent, fetchFn, now: () => 1000});
    return app;
}

async function tokenFor(url: string, headers: Record<string, string> = {}) {
    return signProxyToken(SECRET, {url, headers, exp: 2000});
}

describe('/v/ proxy', () => {
    test('streams a 200 with forwarded headers and required upstream headers', async () => {
        let seen: Headers | undefined;
        const fetchFn = (async (_input: unknown, init?: RequestInit) => {
            seen = new Headers(init?.headers);
            return new Response('VIDEOBYTES', {
                status: 200,
                headers: {
                    'content-type': 'video/mp4',
                    'content-length': '10',
                    'set-cookie': 'x=1',
                },
            });
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4', {
            Referer: 'https://www.tiktok.com/',
        });
        const res = await app.request(`/v/${tok}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('video/mp4');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('set-cookie')).toBeNull(); // upstream cookie dropped
        expect(seen?.get('Referer')).toBe('https://www.tiktok.com/');
        expect(await res.text()).toBe('VIDEOBYTES');
    });

    test('forwards Range and preserves 206 + content-range', async () => {
        let seenRange: string | null | undefined;
        const fetchFn = (async (_input: unknown, init?: RequestInit) => {
            seenRange = new Headers(init?.headers).get('Range');
            return new Response('PART', {
                status: 206,
                headers: {
                    'content-range': 'bytes 0-3/10',
                    'content-length': '4',
                },
            });
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        const res = await app.request(`/v/${tok}`, {
            headers: {Range: 'bytes=0-3'},
        });
        expect(res.status).toBe(206);
        expect(seenRange).toBe('bytes=0-3');
        expect(res.headers.get('content-range')).toBe('bytes 0-3/10');
    });

    test('404 on bad token', async () => {
        const app = await appWith(
            (async () => new Response('x')) as unknown as FetchFn,
        );
        expect((await app.request('/v/garbage')).status).toBe(404);
    });

    test('403 when host not on allowlist', async () => {
        const app = await appWith(
            (async () => new Response('x')) as unknown as FetchFn,
        );
        const tok = await tokenFor('https://evil.test/a.mp4');
        expect((await app.request(`/v/${tok}`)).status).toBe(403);
    });

    test('502 when upstream errors', async () => {
        const app = await appWith(
            (async () =>
                new Response('no', {status: 500})) as unknown as FetchFn,
        );
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        expect((await app.request(`/v/${tok}`)).status).toBe(502);
    });

    test('502 when non-range body exceeds byte ceiling', async () => {
        const fetchFn = (async () =>
            new Response('x', {
                status: 200,
                headers: {'content-length': '999999999'},
            })) as unknown as FetchFn;
        const app = await appWith(fetchFn, {PROXY_MAX_BYTES: '1000'});
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        expect((await app.request(`/v/${tok}`)).status).toBe(502);
    });

    test('404 when proxy secret is unset (disabled)', async () => {
        const config = loadConfig({}); // no PROXY_SECRET
        const app = new Hono();
        mountProxy(app, {
            config,
            logger: silent,
            fetchFn: (async () => new Response('x')) as unknown as FetchFn,
            now: () => 1000,
        });
        const tok = await signProxyToken('s', {
            url: 'https://v16.tiktokcdn.com/a.mp4',
            headers: {},
            exp: 2000,
        });
        expect((await app.request(`/v/${tok}`)).status).toBe(404);
    });

    test('404 on expired token', async () => {
        const app = await appWith(
            (async () => new Response('x')) as unknown as FetchFn,
        );
        const expired = await signProxyToken(SECRET, {
            url: 'https://v16.tiktokcdn.com/a.mp4',
            headers: {},
            exp: 500,
        });
        expect((await app.request(`/v/${expired}`)).status).toBe(404); // now()=1000 > exp=500
    });

    test('follows a redirect to an allowlisted host and re-validates each hop', async () => {
        const hosts: string[] = [];
        const fetchFn = (async (input: unknown) => {
            const url = new URL(String(input));
            hosts.push(url.hostname);
            if (url.hostname === 'v16.tiktokcdn.com') {
                return new Response(null, {
                    status: 302,
                    headers: {location: 'https://cdn.muscdn.com/signed.mp4'},
                });
            }
            return new Response('BYTES', {
                status: 200,
                headers: {'content-type': 'video/mp4'},
            });
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        const res = await app.request(`/v/${tok}`);
        expect(res.status).toBe(200);
        expect(hosts).toEqual(['v16.tiktokcdn.com', 'cdn.muscdn.com']);
        expect(await res.text()).toBe('BYTES');
    });

    test('403 when a redirect points off the allowlist (SSRF guard)', async () => {
        const fetchFn = (async (input: unknown) => {
            if (new URL(String(input)).hostname === 'v16.tiktokcdn.com') {
                return new Response(null, {
                    status: 302,
                    headers: {
                        location: 'http://169.254.169.254/latest/meta-data/',
                    },
                });
            }
            return new Response('SECRET', {status: 200});
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        expect((await app.request(`/v/${tok}`)).status).toBe(403);
    });

    test('403 on non-https target scheme, even on an allowlisted host', async () => {
        const app = await appWith(
            (async () => new Response('x')) as unknown as FetchFn,
        );
        // hostname is allowlisted but scheme is http / file — must be rejected
        expect(
            (
                await app.request(
                    `/v/${await tokenFor('http://v16.tiktokcdn.com/a.mp4')}`,
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await app.request(
                    `/v/${await tokenFor('file://cdninstagram.com/etc/passwd')}`,
                )
            ).status,
        ).toBe(403);
    });

    test('403 on redirect scheme downgrade to http', async () => {
        const fetchFn = (async (input: unknown) => {
            if (new URL(String(input)).hostname === 'v16.tiktokcdn.com') {
                return new Response(null, {
                    status: 302,
                    headers: {location: 'http://cdn.muscdn.com/x.mp4'},
                });
            }
            return new Response('x', {status: 200});
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        expect(
            (
                await app.request(
                    `/v/${await tokenFor('https://v16.tiktokcdn.com/a.mp4')}`,
                )
            ).status,
        ).toBe(403);
    });

    test('502 after too many redirect hops', async () => {
        // always redirect to another allowlisted host → exceeds MAX_REDIRECTS
        const fetchFn = (async () =>
            new Response(null, {
                status: 302,
                headers: {location: 'https://v16.tiktokcdn.com/next.mp4'},
            })) as unknown as FetchFn;
        const app = await appWith(fetchFn);
        expect(
            (
                await app.request(
                    `/v/${await tokenFor('https://v16.tiktokcdn.com/a.mp4')}`,
                )
            ).status,
        ).toBe(502);
    });

    test("502 when a 206 body's content-range total exceeds the ceiling", async () => {
        const fetchFn = (async () =>
            new Response('PART', {
                status: 206,
                headers: {
                    'content-range': 'bytes 0-3/999999999',
                    'content-length': '4',
                },
            })) as unknown as FetchFn;
        const app = await appWith(fetchFn, {PROXY_MAX_BYTES: '1000'});
        expect(
            (
                await app.request(
                    `/v/${await tokenFor('https://v16.tiktokcdn.com/a.mp4')}`,
                    {headers: {Range: 'bytes=0-3'}},
                )
            ).status,
        ).toBe(502);
    });

    test('streaming byteCeiling errors the body when an undeclared response overflows', async () => {
        // No content-length/content-range → declared check can't catch it; the
        // streaming counter must. Two 600-byte chunks vs a 1000-byte ceiling.
        const big = 'a'.repeat(600);
        const fetchFn = (async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(ctrl) {
                    const enc = new TextEncoder();
                    ctrl.enqueue(enc.encode(big));
                    ctrl.enqueue(enc.encode(big));
                    ctrl.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: {'content-type': 'video/mp4'},
            });
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn, {PROXY_MAX_BYTES: '1000'});
        const res = await app.request(
            `/v/${await tokenFor('https://v16.tiktokcdn.com/a.mp4')}`,
        );
        expect(res.status).toBe(200); // headers already sent before the overflow
        await expect(res.text()).rejects.toThrow(); // body stream errors past the ceiling
    });

    test('concurrency cap counts in-flight streaming transfers, not just the header phase', async () => {
        // Upstream sends headers immediately but holds the body open until `gate`
        // resolves. Before the fix, `inflight` was decremented when the Response was
        // built (headers received), so the cap bounded nothing while bodies streamed.
        let openGate!: () => void;
        const gate = new Promise<void>((r) => (openGate = r));
        const fetchFn = (async () => {
            const stream = new ReadableStream<Uint8Array>({
                async start(ctrl) {
                    ctrl.enqueue(new TextEncoder().encode('chunk'));
                    await gate; // hold the transfer in-flight
                    ctrl.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: {'content-type': 'video/mp4'},
            });
        }) as unknown as FetchFn;
        const config = loadConfig({
            PROXY_SECRET: SECRET,
            PROXY_MAX_CONCURRENT: '1',
        });
        const app = new Hono();
        mountProxy(app, {config, logger: silent, fetchFn, now: () => 1000});
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');

        // First request occupies the only slot; its body is still streaming (unread).
        const res1 = await app.request(`/v/${tok}`);
        expect(res1.status).toBe(200);
        // Second concurrent request must be rejected — the transfer is still live.
        const res2 = await app.request(`/v/${tok}`);
        expect(res2.status).toBe(503);
        // Let the first transfer finish and drain it so its slot is released.
        openGate();
        expect(await res1.text()).toBe('chunk');
        // Slot freed → a subsequent request succeeds again.
        const res3 = await app.request(`/v/${tok}`);
        expect(res3.status).toBe(200);
        expect(await res3.text()).toBe('chunk');
    });

    test('aborts a stalled upstream body via the idle-read timeout', async () => {
        // Upstream sends headers + one chunk, then goes silent forever (never sends
        // more, never closes). The idle-read watchdog must error the body instead of
        // hanging the transfer open indefinitely.
        const fetchFn = (async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(ctrl) {
                    ctrl.enqueue(new TextEncoder().encode('chunk'));
                    // no further enqueue, no close → upstream stall
                },
            });
            return new Response(stream, {
                status: 200,
                headers: {'content-type': 'video/mp4'},
            });
        }) as unknown as FetchFn;
        const app = await appWith(fetchFn, {PROXY_TIMEOUT_MS: '100'});
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        const res = await app.request(`/v/${tok}`);
        expect(res.status).toBe(200); // headers already sent
        await expect(res.text()).rejects.toThrow(); // body errors after the idle timeout
    });

    test('429 when the client IP exceeds the rate limit', async () => {
        const config = loadConfig({
            PROXY_SECRET: SECRET,
            RATE_LIMIT_PER_MIN: '1',
        });
        const app = new Hono();
        mountProxy(app, {
            config,
            logger: silent,
            rateLimitStore: new MemoryRateLimitStore(),
            fetchFn: (async () =>
                new Response('x', {status: 200})) as unknown as FetchFn,
            now: () => 1000,
        });
        const tok = await tokenFor('https://v16.tiktokcdn.com/a.mp4');
        expect((await app.request(`/v/${tok}`)).status).toBe(200);
        expect((await app.request(`/v/${tok}`)).status).toBe(429);
    });

    test('isHostAllowed resists suffix-bypass shapes', () => {
        const list = ['tiktokcdn.com', 'cdninstagram.com'];
        expect(isHostAllowed('v16.tiktokcdn.com', list)).toBe(true);
        expect(isHostAllowed('tiktokcdn.com', list)).toBe(true);
        expect(isHostAllowed('evil-tiktokcdn.com', list)).toBe(false);
        expect(isHostAllowed('tiktokcdn.com.evil.com', list)).toBe(false);
        expect(isHostAllowed('cdninstagram.com.attacker.net', list)).toBe(
            false,
        );
        expect(isHostAllowed('notcdninstagram.com', list)).toBe(false);
    });
});
