import {describe, expect, test} from 'bun:test';
import TiktokAdapter from '@/adapters/TiktokAdapter';
import {TIKTOK_DEFAULTS} from '@/config/defaults';
import Config from '@/config/Config';
import HttpClient, {CHROME_UA} from '@/services/HttpClient';
import type {FetchFn} from '@/services/HttpClient';
import videoFixture from './fixtures/tiktok/universal-video.json';
import photoFixture from './fixtures/tiktok/universal-photo.json';

const CONFIG = {tiktok: TIKTOK_DEFAULTS} as unknown as Config;

interface Recorded {
    url: string;
    redirect?: RequestRedirect;
    headers: Headers;
}

// Wrap a __DEFAULT_SCOPE__ fixture in a minimal HTML page exactly as TikTok ships
// it, so the adapter's <script id="…"> extraction runs against realistic input.
function pageHtml(
    fixture: unknown,
    scriptId = TIKTOK_DEFAULTS.rehydrationScriptId,
): string {
    return (
        `<!doctype html><html><head><title>TikTok</title></head><body>` +
        `<script id="${scriptId}" type="application/json">${JSON.stringify(fixture)}</script>` +
        `</body></html>`
    );
}

// A fake fetch that serves the video page for any /@user/video|photo/<id> request.
function pageFetch(fixture: unknown, recorded?: Recorded[]): FetchFn {
    return (async (input: unknown, init?: RequestInit) => {
        recorded?.push({
            url: String(input),
            redirect: init?.redirect,
            headers: new Headers(init?.headers),
        });
        return new Response(pageHtml(fixture), {status: 200});
    }) as unknown as FetchFn;
}

const VIDEO_URL = new URL(
    'https://www.tiktok.com/@janetravels/video/7311234567890123456',
);
const PHOTO_URL = new URL(
    'https://www.tiktok.com/@photoguy/photo/7322234567890123456',
);

describe('tiktok adapter', () => {
    const a = new TiktokAdapter(CONFIG, new HttpClient());

    test('match: exact hosts + full-post/short-link shapes only', () => {
        expect(a.match(VIDEO_URL)).toBe(true);
        expect(a.match(PHOTO_URL)).toBe(true);
        expect(a.match(new URL('https://tiktok.com/@u/video/123'))).toBe(true);
        expect(a.match(new URL('https://m.tiktok.com/@u/video/123'))).toBe(
            true,
        );
        // short-link hosts match on any (non-root) path
        expect(a.match(new URL('https://vm.tiktok.com/ZMabcd123/'))).toBe(true);
        expect(a.match(new URL('https://vt.tiktok.com/ZMabcd123'))).toBe(true);
        // /t/<short> on a main host is also a short link
        expect(a.match(new URL('https://www.tiktok.com/t/ZMabcd123'))).toBe(
            true,
        );
        // profile-only / root — no post segment
        expect(a.match(new URL('https://www.tiktok.com/@janetravels'))).toBe(
            false,
        );
        expect(a.match(new URL('https://www.tiktok.com/'))).toBe(false);
        expect(a.match(new URL('https://vm.tiktok.com/'))).toBe(false);
        // wrong hosts (substring / subdomain must not match)
        expect(
            a.match(new URL('https://tiktok.example.com/@u/video/123')),
        ).toBe(false);
        expect(a.match(new URL('https://x-tiktok.com/@u/video/123'))).toBe(
            false,
        );
        expect(a.match(new URL('https://nottiktok.com/@u/video/123'))).toBe(
            false,
        );
    });

    test('canonicalize: full posts normalize, short links kept raw', () => {
        expect(
            a.canonicalize(
                new URL('https://www.tiktok.com/@u/video/123?is_from_webapp=1'),
            ),
        ).toBe('https://www.tiktok.com/@u/video/123');
        expect(
            a.canonicalize(new URL('https://m.tiktok.com/@u/photo/456?x=1')),
        ).toBe('https://www.tiktok.com/@u/photo/456');
        // short links resolve at fetch time — canonicalize returns the raw URL
        expect(
            a.canonicalize(new URL('https://vm.tiktok.com/ZMabcd123/')),
        ).toBe('https://vm.tiktok.com/ZMabcd123/');
    });

    test('short link: manual redirect -> aweme id -> page scrape', async () => {
        const recorded: Recorded[] = [];
        const fetchFn = (async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            recorded.push({
                url,
                redirect: init?.redirect,
                headers: new Headers(init?.headers),
            });
            if (url.startsWith('https://vm.tiktok.com/')) {
                return new Response(null, {
                    status: 301,
                    headers: {
                        Location:
                            'https://www.tiktok.com/@janetravels/video/7311234567890123456?is_from_webapp=1',
                    },
                });
            }
            return new Response(pageHtml(videoFixture), {status: 200});
        }) as unknown as FetchFn;

        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        const m = await ad.resolve(new URL('https://vm.tiktok.com/ZMabcd123/'));

        // step 1: manual redirect probe with a browser UA
        expect(recorded[0]!.url).toBe('https://vm.tiktok.com/ZMabcd123/');
        expect(recorded[0]!.redirect).toBe('manual');
        expect(recorded[0]!.headers.get('User-Agent')).toBe(CHROME_UA);
        // step 2: page scrape at the resolved full-post URL (id extracted from Location)
        expect(recorded[1]!.url).toBe(
            'https://www.tiktok.com/@janetravels/video/7311234567890123456',
        );
        expect(m.kind).toBe('video');
        expect(m.originalUrl).toBe(
            'https://www.tiktok.com/@janetravels/video/7311234567890123456',
        );
    });

    test('short link: /v/<id>.html variant rewrites to /@i/video/<id>', async () => {
        const recorded: Recorded[] = [];
        const fetchFn = (async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            recorded.push({
                url,
                redirect: init?.redirect,
                headers: new Headers(init?.headers),
            });
            if (url.startsWith('https://vt.tiktok.com/')) {
                return new Response(null, {
                    status: 301,
                    headers: {
                        Location:
                            'https://m.tiktok.com/v/7311234567890123456.html',
                    },
                });
            }
            return new Response(pageHtml(videoFixture), {status: 200});
        }) as unknown as FetchFn;

        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        const m = await ad.resolve(new URL('https://vt.tiktok.com/ZMxyz'));
        expect(recorded[1]!.url).toBe(
            'https://www.tiktok.com/@i/video/7311234567890123456',
        );
        expect(m.kind).toBe('video');
    });

    test('short link that does not redirect throws', async () => {
        const fetchFn = (async () =>
            new Response(null, {status: 200})) as unknown as FetchFn;
        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        expect(
            ad.resolve(new URL('https://vm.tiktok.com/ZMabcd123')),
        ).rejects.toThrow();
    });

    test('video: highest-bitrate PlayAddr, proxyHeaders, dims, poster, ttl', async () => {
        const recorded: Recorded[] = [];
        const ad = new TiktokAdapter(
            CONFIG,
            new HttpClient(pageFetch(videoFixture, recorded)),
        );
        const m = await ad.resolve(VIDEO_URL);

        expect(m.kind).toBe('video');
        // highest .Bitrate (1_200_000) wins over the low/mid entries regardless of order
        expect(m.video?.url).toBe(
            'https://v16-webapp.tiktokcdn.com/high_1200.mp4?a=1',
        );
        // RAW play URL is emitted — the app wraps it in the /v/ proxy (T25)
        expect(
            m.video?.url.startsWith('https://v16-webapp.tiktokcdn.com/'),
        ).toBe(true);
        expect(m.video?.mimeType).toBe('video/mp4');
        expect(m.video?.width).toBe(576);
        expect(m.video?.height).toBe(1024);
        // TikTok play URLs are IP/UA-locked → always proxied
        expect(m.video?.proxyHeaders?.['User-Agent']).toBe(CHROME_UA);
        expect(m.video?.proxyHeaders?.Referer).toBe('https://www.tiktok.com/');
        expect(m.image?.url).toBe(
            'https://p16-sign.tiktokcdn.com/cover_720.jpg?x-expires=1',
        );
        expect(m.ttlSeconds).toBe(3600);

        expect(m.title).toBe('Jane Traveler (@janetravels)');
        expect(m.description).toBe('Sunset timelapse from the rooftop 🌇');
        expect(m.author?.name).toBe('Jane Traveler');
        expect(m.author?.url).toBe('https://www.tiktok.com/@janetravels');
        expect(m.siteName).toBe('TikTok');
        expect(m.themeColor).toBe('#FE2C55');
        expect(m.nsfw).toBe(false);
        expect(m.originalUrl).toBe(
            'https://www.tiktok.com/@janetravels/video/7311234567890123456',
        );
        // page scrape carried the browser UA
        expect(recorded[0]!.headers.get('User-Agent')).toBe(CHROME_UA);
    });

    test('video: session cookies from the page scrape are forwarded as proxy Cookie', async () => {
        const fetchFn = (async () => {
            // TikTok sets ttwid/tt_csrf on the page response; the signed play URL
            // 403s without them — they must ride along in the proxy headers.
            const headers = new Headers({'content-type': 'text/html'});
            headers.append(
                'set-cookie',
                'ttwid=abc123; Path=/; Secure; HttpOnly',
            );
            headers.append('set-cookie', 'tt_csrf_token=xyz; Path=/');
            return new Response(pageHtml(videoFixture), {status: 200, headers});
        }) as unknown as FetchFn;
        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        const m = await ad.resolve(VIDEO_URL);
        expect(m.video?.proxyHeaders?.Cookie).toBe(
            'ttwid=abc123; tt_csrf_token=xyz',
        );
        // UA + Referer still present
        expect(m.video?.proxyHeaders?.['User-Agent']).toBe(CHROME_UA);
    });

    test('video: no Cookie header when the page sets no cookies', async () => {
        const ad = new TiktokAdapter(
            CONFIG,
            new HttpClient(pageFetch(videoFixture)),
        );
        const m = await ad.resolve(VIDEO_URL);
        expect(m.video?.proxyHeaders?.Cookie).toBeUndefined();
        expect(m.video?.proxyHeaders?.['User-Agent']).toBe(CHROME_UA);
    });

    test('video: falls back to video.playAddr when bitrateInfo is empty', async () => {
        const noBitrate = structuredClone(
            videoFixture,
        ) as typeof videoFixture & {
            __DEFAULT_SCOPE__: {
                'webapp.video-detail': {
                    itemInfo: {itemStruct: {video: {bitrateInfo?: unknown[]}}};
                };
            };
        };
        noBitrate.__DEFAULT_SCOPE__[
            'webapp.video-detail'
        ].itemInfo.itemStruct.video.bitrateInfo = [];
        const ad = new TiktokAdapter(
            CONFIG,
            new HttpClient(pageFetch(noBitrate)),
        );
        const m = await ad.resolve(VIDEO_URL);
        expect(m.kind).toBe('video');
        expect(m.video?.url).toBe(
            'https://v16-webapp.tiktokcdn.com/fallback_play.mp4?a=1',
        );
    });

    test('photo post: first image + count marker', async () => {
        const ad = new TiktokAdapter(
            CONFIG,
            new HttpClient(pageFetch(photoFixture)),
        );
        const m = await ad.resolve(PHOTO_URL);
        expect(m.kind).toBe('image');
        expect(m.image?.url).toBe(
            'https://p16-sign.tiktokcdn.com/photo1_full.jpg?x-expires=1',
        );
        expect(m.title).toBe('Photo Guy (@photoguy)');
        expect(m.description).toBe('Weekend photo dump 📷 3 images');
        expect(m.video).toBeUndefined();
        expect(m.originalUrl).toBe(
            'https://www.tiktok.com/@photoguy/photo/7322234567890123456',
        );
    });

    test('restricted statusCode -> informative link embed (no throw)', async () => {
        for (const code of [209002, 209004]) {
            const restricted = {
                __DEFAULT_SCOPE__: {'webapp.video-detail': {statusCode: code}},
            };
            const ad = new TiktokAdapter(
                CONFIG,
                new HttpClient(pageFetch(restricted)),
            );
            const m = await ad.resolve(VIDEO_URL);
            expect(m.kind).toBe('link');
            expect(m.description).toContain('region-restricted or private');
            expect(m.siteName).toBe('TikTok');
            expect(m.nsfw).toBeFalsy();
            expect(m.originalUrl).toBe(
                'https://www.tiktok.com/@janetravels/video/7311234567890123456',
            );
        }
    });

    test('not-found statusCode 10204 throws', async () => {
        const notFound = {
            __DEFAULT_SCOPE__: {'webapp.video-detail': {statusCode: 10204}},
        };
        const ad = new TiktokAdapter(
            CONFIG,
            new HttpClient(pageFetch(notFound)),
        );
        expect(ad.resolve(VIDEO_URL)).rejects.toThrow('tiktok: not found');
    });

    test('missing rehydration script throws', async () => {
        const fetchFn = (async () =>
            new Response('<html><body>no data here</body></html>', {
                status: 200,
            })) as unknown as FetchFn;
        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        expect(ad.resolve(VIDEO_URL)).rejects.toThrow();
    });

    test('non-OK page response throws', async () => {
        const fetchFn = (async () =>
            new Response('blocked', {status: 403})) as unknown as FetchFn;
        const ad = new TiktokAdapter(CONFIG, new HttpClient(fetchFn));
        expect(ad.resolve(VIDEO_URL)).rejects.toThrow();
    });

    test('TIKTOK_DEFAULTS wires the web + (future) mobile-API config fields', () => {
        expect(TIKTOK_DEFAULTS.rehydrationScriptId).toBe(
            '__UNIVERSAL_DATA_FOR_REHYDRATION__',
        );
        expect(TIKTOK_DEFAULTS.mobileApiHost).toBeTruthy();
        expect(TIKTOK_DEFAULTS.iid).toBeTruthy();
        expect(TIKTOK_DEFAULTS.deviceId).toBeTruthy();
    });

    test('config is injectable: custom rehydrationScriptId is used for extraction', async () => {
        const fetchFn = (async () =>
            new Response(pageHtml(videoFixture, '__CUSTOM_DATA__'), {
                status: 200,
            })) as unknown as FetchFn;
        const ad = new TiktokAdapter(
            {
                tiktok: {
                    ...TIKTOK_DEFAULTS,
                    rehydrationScriptId: '__CUSTOM_DATA__',
                },
            } as unknown as Config,
            new HttpClient(fetchFn),
        );
        const m = await ad.resolve(VIDEO_URL);
        expect(m.kind).toBe('video');
        expect(m.title).toBe('Jane Traveler (@janetravels)');
    });
});
