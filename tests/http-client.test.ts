import {expect, test} from 'bun:test';
import HttpClient, {PLATFORM_UA, type FetchFn} from '@/services/HttpClient';

test('fetch applies default UA when caller sets none', async () => {
    let captured: Headers | undefined;
    const mock = (async (_url: string, init?: RequestInit) => {
        captured = new Headers(init?.headers);
        return new Response('ok');
    }) as unknown as FetchFn;
    await new HttpClient(mock).fetch('https://x.test/');
    expect(captured?.get('User-Agent')).toBe(PLATFORM_UA);
});

test('fetch preserves a caller-set UA', async () => {
    let captured: Headers | undefined;
    const mock = (async (_url: string, init?: RequestInit) => {
        captured = new Headers(init?.headers);
        return new Response('ok');
    }) as unknown as FetchFn;
    await new HttpClient(mock).fetch('https://x.test/', {
        headers: {'User-Agent': 'custom'},
    });
    expect(captured?.get('User-Agent')).toBe('custom');
});

test('getJson throws on non-ok', async () => {
    const mock = (async () =>
        new Response('nope', {status: 404})) as unknown as FetchFn;
    await expect(
        new HttpClient(mock).getJson('https://x.test/'),
    ).rejects.toThrow('request failed 404');
});

test('getJson parses ok body', async () => {
    const mock = (async () =>
        new Response(JSON.stringify({a: 1}))) as unknown as FetchFn;
    expect(
        await new HttpClient(mock).getJson<{a: number}>('https://x.test/'),
    ).toEqual({
        a: 1,
    });
});
