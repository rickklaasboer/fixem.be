import {describe, expect, test} from 'bun:test';
import {createTwitchAdapter} from '../src/adapters/twitch';
import type {FetchFn} from '../src/adapters/types';
import helixClip from './fixtures/twitch/helix-clip.json';
import gqlClip from './fixtures/twitch/gql-clip.json';

const CREDS = {clientId: 'cid', clientSecret: 'sec'};

function fakeFetch(opts: {gqlBody?: unknown; helixFirst401?: boolean} = {}) {
    const requests: {url: string; auth?: string; body?: string}[] = [];
    let helix401Left = opts.helixFirst401 ? 1 : 0;
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        requests.push({
            url,
            auth: headers.get('Authorization') ?? undefined,
            body: init?.body?.toString(),
        });
        if (url.includes('id.twitch.tv/oauth2/token')) {
            return new Response(
                JSON.stringify({
                    access_token: `tok${requests.length}`,
                    expires_in: 5011271,
                }),
            );
        }
        if (url.includes('api.twitch.tv/helix/clips')) {
            if (helix401Left > 0) {
                helix401Left--;
                return new Response('unauthorized', {status: 401});
            }
            return new Response(JSON.stringify(helixClip));
        }
        if (url.includes('gql.twitch.tv')) {
            return new Response(JSON.stringify(opts.gqlBody ?? gqlClip));
        }
        return new Response('not found', {status: 404});
    }) as unknown as FetchFn;
    return {fetchFn, requests};
}

const CLIP_URL = new URL(
    'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage',
);

describe('twitch adapter', () => {
    const a = createTwitchAdapter(CREDS, fakeFetch().fetchFn);

    test('match covers both clip URL shapes, rejects non-clips', () => {
        expect(a.match(CLIP_URL)).toBe(true);
        expect(
            a.match(
                new URL(
                    'https://www.twitch.tv/streamer_jane/clip/AwkwardHelplessSalamanderSwiftRage',
                ),
            ),
        ).toBe(true);
        expect(
            a.match(
                new URL('https://m.twitch.tv/streamer_jane/clip/Slug-123_x'),
            ),
        ).toBe(true);
        expect(a.match(new URL('https://www.twitch.tv/streamer_jane'))).toBe(
            false,
        );
        expect(a.match(new URL('https://twitch.example/x/clip/y'))).toBe(false);
        expect(a.match(new URL('https://clips.twitch.tv/SomeSlug/extra'))).toBe(
            false,
        );
        expect(
            a.match(new URL('https://clips.twitch.tv/embed?clip=SomeSlug')),
        ).toBe(true);
        expect(
            a.canonicalize(
                new URL('https://clips.twitch.tv/embed?clip=SomeSlug'),
            ),
        ).toBe('https://clips.twitch.tv/SomeSlug');
    });

    test('canonicalize maps to clips.twitch.tv', () => {
        expect(
            a.canonicalize(
                new URL(
                    'https://www.twitch.tv/streamer_jane/clip/AwkwardHelplessSalamanderSwiftRage?tt_medium=x',
                ),
            ),
        ).toBe('https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage');
    });

    test('resolves metadata + signed MP4, caches app token', async () => {
        const {fetchFn, requests} = fakeFetch();
        const ad = createTwitchAdapter(CREDS, fetchFn);
        const m = await ad.resolve(CLIP_URL);
        expect(m.kind).toBe('video');
        expect(m.title).toBe('Unbelievable clutch play');
        expect(m.author?.name).toBe('streamer_jane');
        expect(m.siteName).toBe('Twitch');
        expect(m.video?.url).toBe(
            'https://production.assets.clips.twitchcdn.net/v2/media/xyz/1080.mp4?sig=deadbeefcafe&token=%7B%22authorization%22%3A%7B%7D%7D',
        );
        expect(m.video?.height).toBe(1080);
        expect(m.video?.width).toBe(1920);
        expect(m.image?.url).toContain('preview-480x272.jpg');
        expect(m.ttlSeconds).toBe(1800);
        await ad.resolve(CLIP_URL);
        expect(
            requests.filter((r) => r.url.includes('oauth2/token')).length,
        ).toBe(1);
    });

    test('401 from helix re-mints token and retries once', async () => {
        const {fetchFn, requests} = fakeFetch({helixFirst401: true});
        const ad = createTwitchAdapter(CREDS, fetchFn);
        const m = await ad.resolve(CLIP_URL);
        expect(m.title).toBe('Unbelievable clutch play');
        expect(
            requests.filter((r) => r.url.includes('oauth2/token')).length,
        ).toBe(2);
    });

    test('GQL failure degrades to image-only embed (no throw)', async () => {
        const {fetchFn} = fakeFetch({gqlBody: {data: {clip: null}}});
        const ad = createTwitchAdapter(CREDS, fetchFn);
        const m = await ad.resolve(CLIP_URL);
        expect(m.kind).toBe('image');
        expect(m.video).toBeUndefined();
        expect(m.image?.url).toContain('preview');
    });

    test('clip not found throws', async () => {
        const {fetchFn} = fakeFetch();
        const ad = createTwitchAdapter(CREDS, (async (
            input: unknown,
            init?: RequestInit,
        ) => {
            const url = String(input);
            if (url.includes('oauth2/token'))
                return new Response(
                    JSON.stringify({access_token: 't', expires_in: 100}),
                );
            if (url.includes('helix/clips'))
                return new Response(JSON.stringify({data: []}));
            return fetchFn(input as Parameters<FetchFn>[0], init);
        }) as unknown as FetchFn);
        expect(ad.resolve(CLIP_URL)).rejects.toThrow('twitch: clip not found');
    });
});
