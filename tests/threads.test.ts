import {describe, expect, test} from 'bun:test';
import ThreadsAdapter from '@/adapters/ThreadsAdapter';
import {THREADS_DEFAULTS} from '@/config/defaults';
import Config from '@/config/Config';
import HttpClient, {FIREFOX_UA} from '@/services/HttpClient';
import type {FetchFn} from '@/services/HttpClient';
import routeFixture from './fixtures/threads/route.json';
import postImage from './fixtures/threads/post-image.json';
import postVideo from './fixtures/threads/post-video.json';

function createThreadsAdapter(
    fetchFn: FetchFn = fetch,
    threadsConfig = THREADS_DEFAULTS,
): ThreadsAdapter {
    return new ThreadsAdapter(
        {threads: threadsConfig} as unknown as Config,
        new HttpClient(fetchFn),
    );
}

interface Recorded {
    url: string;
    body?: string;
    headers: Headers;
}

// Routes the two anonymous Threads calls to fixtures. The bulk-route response is
// wrapped with the real `for (;;);` XSS-guard prefix so the adapter's strip runs.
function fakeFetch(
    opts: {post?: unknown; route?: unknown; recorded?: Recorded[]} = {},
): FetchFn {
    const route = opts.route ?? routeFixture;
    const post = opts.post ?? postImage;
    return (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        opts.recorded?.push({
            url,
            body: init?.body?.toString(),
            headers: new Headers(init?.headers),
        });
        if (url.includes('bulk-route-definitions')) {
            return new Response(`for (;;);${JSON.stringify(route)}`);
        }
        if (url.includes('/api/graphql')) {
            return new Response(JSON.stringify(post));
        }
        return new Response('not found', {status: 404});
    }) as unknown as FetchFn;
}

const POST_URL = new URL('https://www.threads.com/@johndoe/post/ABC123');

describe('threads adapter', () => {
    const a = createThreadsAdapter();

    test('match: exact hosts + post/short path shapes only', () => {
        expect(a.match(POST_URL)).toBe(true);
        expect(
            a.match(new URL('https://threads.net/@johndoe/post/ABC123')),
        ).toBe(true);
        expect(
            a.match(new URL('https://www.threads.net/@johndoe/post/ABC123')),
        ).toBe(true);
        expect(a.match(new URL('https://threads.com/t/ABC123'))).toBe(true);
        expect(a.match(new URL('https://www.threads.com/t/ABC123'))).toBe(true);
        // profile-only, no post segment
        expect(a.match(new URL('https://www.threads.com/@johndoe'))).toBe(
            false,
        );
        // wrong hosts (substring / subdomain must not match)
        expect(
            a.match(
                new URL('https://threads.example.com/@johndoe/post/ABC123'),
            ),
        ).toBe(false);
        expect(
            a.match(new URL('https://x-threads.com/@johndoe/post/ABC123')),
        ).toBe(false);
        expect(a.match(new URL('https://notthreads.com/t/ABC123'))).toBe(false);
    });

    test('canonicalize: strips query, forces threads.com, keeps /t/ form', () => {
        expect(
            a.canonicalize(
                new URL('https://threads.net/@johndoe/post/ABC123?igshid=xyz'),
            ),
        ).toBe('https://www.threads.com/@johndoe/post/ABC123');
        expect(
            a.canonicalize(new URL('https://www.threads.com/t/ABC123?x=1')),
        ).toBe('https://www.threads.com/t/ABC123');
    });

    test('two-call ordering: route -> graphql carrying the resolved post_id', async () => {
        const recorded: Recorded[] = [];
        const ad = createThreadsAdapter(fakeFetch({recorded}));
        await ad.resolve(POST_URL);
        expect(recorded).toHaveLength(2);
        expect(recorded[0]!.url).toContain('bulk-route-definitions');
        // Raw wire format: the route_urls[0] key must NOT be percent-encoded.
        expect(recorded[0]!.body).toContain('route_urls[0]=');
        expect(recorded[0]!.body).not.toContain('route_urls%5B0%5D');
        expect(recorded[0]!.body).toContain(`lsd=${THREADS_DEFAULTS.lsd}`);
        expect(recorded[0]!.headers.get('X-FB-LSD')).toBe(THREADS_DEFAULTS.lsd);
        expect(recorded[0]!.headers.get('User-Agent')).toBe(FIREFOX_UA);

        expect(recorded[1]!.url).toContain('/api/graphql');
        // post_id from route.json flows into the graphql variables
        expect(recorded[1]!.body).toContain('31112223334');
        expect(recorded[1]!.body).toContain(`doc_id=${THREADS_DEFAULTS.docId}`);
        expect(recorded[1]!.headers.get('X-FB-Friendly-Name')).toBe(
            THREADS_DEFAULTS.friendlyName,
        );
        expect(recorded[1]!.headers.get('X-IG-App-ID')).toBe(
            THREADS_DEFAULTS.appId,
        );
    });

    test('image post: image kind, title, author, description', async () => {
        const ad = createThreadsAdapter(fakeFetch({post: postImage}));
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('image');
        expect(m.title).toBe('johndoe on Threads');
        expect(m.description).toBe('A quiet morning by the lake.');
        expect(m.image?.url).toBe(
            'https://scontent.cdninstagram.com/image_full.jpg?efg=sig',
        );
        expect(m.image?.width).toBe(1080);
        expect(m.image?.height).toBe(1350);
        expect(m.author?.name).toBe('@johndoe');
        expect(m.author?.url).toBe('https://www.threads.com/@johndoe');
        expect(m.siteName).toBe('Threads');
        expect(m.themeColor).toBe('#000000');
        expect(m.nsfw).toBe(false);
        expect(m.originalUrl).toBe(
            'https://www.threads.com/@johndoe/post/ABC123',
        );
    });

    test('video post: raw cdn url + proxyHeaders, dims, poster, ttl', async () => {
        const ad = createThreadsAdapter(fakeFetch({post: postVideo}));
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('video');
        // The RAW cdn URL is emitted; proxy-wrapping is the app's job (T25).
        expect(m.video?.url).toBe(
            'https://scontent.cdninstagram.com/video_720.mp4?efg=sig&_nc_ht=x',
        );
        expect(
            m.video?.url.startsWith('https://scontent.cdninstagram.com/'),
        ).toBe(true);
        expect(m.video?.mimeType).toBe('video/mp4');
        expect(m.video?.width).toBe(720);
        expect(m.video?.height).toBe(1280);
        expect(m.video?.proxyHeaders).toBeDefined();
        expect(m.video?.proxyHeaders?.['User-Agent']).toBe(FIREFOX_UA);
        expect(m.video?.proxyHeaders?.Referer).toBe('https://www.threads.com/');
        expect(m.image?.url).toBe(
            'https://scontent.cdninstagram.com/video_poster.jpg?efg=sig',
        );
        expect(m.ttlSeconds).toBe(3600);
    });

    test('carousel post: first child media + count marker', async () => {
        const carousel = {
            data: {
                data: {
                    containing_thread: {
                        thread_items: [
                            {
                                post: {
                                    user: {username: 'carol'},
                                    caption: {text: 'Trip dump'},
                                    carousel_media: [
                                        {
                                            image_versions2: {
                                                candidates: [
                                                    {
                                                        url: 'https://scontent.cdninstagram.com/c1.jpg',
                                                        width: 800,
                                                        height: 800,
                                                    },
                                                ],
                                            },
                                            original_width: 800,
                                            original_height: 800,
                                        },
                                        {
                                            image_versions2: {
                                                candidates: [
                                                    {
                                                        url: 'https://scontent.cdninstagram.com/c2.jpg',
                                                    },
                                                ],
                                            },
                                        },
                                        {
                                            image_versions2: {
                                                candidates: [
                                                    {
                                                        url: 'https://scontent.cdninstagram.com/c3.jpg',
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            },
        };
        const ad = createThreadsAdapter(fakeFetch({post: carousel}));
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('image');
        expect(m.image?.url).toBe('https://scontent.cdninstagram.com/c1.jpg');
        expect(m.description).toBe('Trip dump 📷 3');
    });

    test('carousel count marker still appears when the post has a top-level cover', async () => {
        const withCover = {
            data: {
                data: {
                    containing_thread: {
                        thread_items: [
                            {
                                post: {
                                    user: {username: 'carol'},
                                    caption: {text: 'Trip dump'},
                                    // top-level cover present — must not suppress the carousel count
                                    image_versions2: {
                                        candidates: [
                                            {
                                                url: 'https://scontent.cdninstagram.com/cover.jpg',
                                                width: 800,
                                                height: 800,
                                            },
                                        ],
                                    },
                                    carousel_media: [
                                        {
                                            image_versions2: {
                                                candidates: [
                                                    {
                                                        url: 'https://scontent.cdninstagram.com/c1.jpg',
                                                    },
                                                ],
                                            },
                                        },
                                        {
                                            image_versions2: {
                                                candidates: [
                                                    {
                                                        url: 'https://scontent.cdninstagram.com/c2.jpg',
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            },
        };
        const ad = createThreadsAdapter(fakeFetch({post: withCover}));
        const m = await ad.resolve(POST_URL);
        expect(m.description).toBe('Trip dump 📷 2');
    });

    test('thread with a text-only last item picks the last item that has .post', async () => {
        const withDangling = {
            data: {
                data: {
                    containing_thread: {
                        thread_items: [
                            {
                                post: postImage.data.data.containing_thread
                                    .thread_items[0]!.post,
                            },
                            {should_be_ignored: true},
                        ],
                    },
                },
            },
        };
        const ad = createThreadsAdapter(fakeFetch({post: withDangling}));
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('image');
        expect(m.title).toBe('johndoe on Threads');
    });

    test('empty thread_items -> informative link embed (no throw)', async () => {
        const empty = {data: {data: {containing_thread: {thread_items: []}}}};
        const ad = createThreadsAdapter(fakeFetch({post: empty}));
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('link');
        expect(m.description).toContain("couldn't be loaded");
        expect(m.siteName).toBe('Threads');
        expect(m.nsfw).toBeFalsy();
        expect(m.originalUrl).toBe(
            'https://www.threads.com/@johndoe/post/ABC123',
        );
    });

    test('GraphQL HTML challenge (Meta bot-block) -> informative link embed (no throw)', async () => {
        // Meta returns a 200 text/html challenge page instead of JSON when it blocks
        // the anonymous GraphQL call — must degrade to the informative embed, not throw
        // (throwing would give a bare URL-as-title redirect).
        const htmlChallenge = (async (input: unknown) => {
            if (String(input).includes('bulk-route-definitions')) {
                return new Response(`for (;;);${JSON.stringify(routeFixture)}`);
            }
            return new Response('<!DOCTYPE html><html>login</html>', {
                status: 200,
                headers: {'content-type': 'text/html'},
            });
        }) as unknown as FetchFn;
        const ad = createThreadsAdapter(htmlChallenge);
        const m = await ad.resolve(POST_URL);
        expect(m.kind).toBe('link');
        expect(m.title).toBe('@johndoe');
        expect(m.description).toContain("couldn't be loaded");
        expect(m.originalUrl).toBe(
            'https://www.threads.com/@johndoe/post/ABC123',
        );
    });

    test('missing post_id from route call throws', async () => {
        const ad = createThreadsAdapter(
            fakeFetch({route: {payload: {payloads: {}}}}),
        );
        await expect(ad.resolve(POST_URL)).rejects.toThrow(/post_id/);
    });

    test('route call transport error throws', async () => {
        const failing = (async () =>
            new Response('blocked', {status: 500})) as unknown as FetchFn;
        const ad = createThreadsAdapter(failing);
        await expect(ad.resolve(POST_URL)).rejects.toThrow();
    });

    test('config is injectable (2nd param overrides defaults)', async () => {
        const recorded: Recorded[] = [];
        const ad = createThreadsAdapter(fakeFetch({recorded}), {
            lsd: 'CUSTOMLSD',
            docId: '999',
            appId: '111',
            friendlyName: 'CustomQuery',
        });
        await ad.resolve(POST_URL);
        expect(recorded[0]!.headers.get('X-FB-LSD')).toBe('CUSTOMLSD');
        expect(recorded[1]!.body).toContain('doc_id=999');
        expect(recorded[1]!.headers.get('X-FB-Friendly-Name')).toBe(
            'CustomQuery',
        );
    });
});
