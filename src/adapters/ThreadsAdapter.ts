import {injectable} from 'tsyringe';
import BaseAdapter from '@/adapters/BaseAdapter';
import Config from '@/config/Config';
import HttpClient, {FIREFOX_UA} from '@/services/HttpClient';
import Text from '@/support/Text';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const HOSTS = new Set([
    'threads.net',
    'www.threads.net',
    'threads.com',
    'www.threads.com',
]);
const POST_RE = /^\/@([^/]+)\/post\/([^/]+)\/?$/;
const SHORT_RE = /^\/t\/([^/]+)\/?$/;

const ROUTE_URL = 'https://www.threads.net/ajax/bulk-route-definitions/';
const GRAPHQL_URL = 'https://www.threads.net/api/graphql';
// Bot-detection fingerprint sent on both anonymous calls (research §1a).
const ASBD_ID = '129477';
// cdninstagram media URLs are signed & short-lived — don't cache past ~1h, and
// only replay when re-fetched with these headers (Discord won't send them).
const MEDIA_TTL_SECONDS = 3600;
const MEDIA_PROXY_HEADERS: Record<string, string> = {
    'User-Agent': FIREFOX_UA,
    Referer: 'https://www.threads.com/',
};

interface ThreadsMediaNode {
    video_versions?: {url?: string}[];
    image_versions2?: {
        candidates?: {url?: string; width?: number; height?: number}[];
    };
    original_width?: number;
    original_height?: number;
}

interface ThreadsPost extends ThreadsMediaNode {
    user?: {username?: string; profile_pic_url?: string};
    caption?: {text?: string};
    carousel_media?: ThreadsMediaNode[];
}

interface GraphqlResponse {
    data?: {
        data?: {containing_thread?: {thread_items?: {post?: ThreadsPost}[]}};
    };
}

interface RootView {
    exports?: {rootView?: {props?: {post_id?: string}}};
}
interface RouteResponse {
    payload?: {
        payloads?: Record<
            string,
            {result?: RootView & {redirect_result?: RootView}}
        >;
    };
}

type Parsed =
    | {form: 'post'; user: string; code: string}
    | {form: 'short'; code: string};

function parsePath(url: URL): Parsed | null {
    const post = url.pathname.match(POST_RE);
    if (post) return {form: 'post', user: post[1]!, code: post[2]!};
    const short = url.pathname.match(SHORT_RE);
    if (short) return {form: 'short', code: short[1]!};
    return null;
}

function canonicalFor(p: Parsed): string {
    return p.form === 'post'
        ? `https://www.threads.com/@${p.user}/post/${p.code}`
        : `https://www.threads.com/t/${p.code}`;
}

// Map a single media node (the post itself or a carousel child) to its kind and
// image/video fields. Shared so carousel children also pick up video proxying.
function pickMedia(
    node: ThreadsMediaNode,
): Pick<EmbedMetadata, 'kind' | 'image' | 'video'> {
    const width = node.original_width ?? 640;
    const height = node.original_height ?? 640;
    const poster = node.image_versions2?.candidates?.[0];

    const videoUrl = node.video_versions?.[0]?.url;
    if (videoUrl) {
        return {
            kind: 'video',
            video: {
                url: videoUrl,
                width,
                height,
                mimeType: 'video/mp4',
                proxyHeaders: MEDIA_PROXY_HEADERS,
            },
            image: poster?.url
                ? {url: poster.url, width: poster.width, height: poster.height}
                : undefined,
        };
    }
    if (poster?.url) {
        return {
            kind: 'image',
            image: {
                url: poster.url,
                width: poster.width ?? width,
                height: poster.height ?? height,
            },
        };
    }
    return {kind: 'link'};
}

/**
 * Threads post embeds via the anonymous bulk-route + GraphQL web-client calls.
 */
@injectable()
export default class ThreadsAdapter extends BaseAdapter {
    public name = 'threads';

    constructor(
        private config: Config,
        private http: HttpClient,
    ) {
        super();
    }

    public match(url: URL): boolean {
        return HOSTS.has(url.hostname) && parsePath(url) !== null;
    }

    public canonicalize(url: URL): string {
        const p = parsePath(url);
        return p ? canonicalFor(p) : url.href;
    }

    /**
     * Resolve a Threads post into embed metadata.
     */
    public async resolve(
        url: URL,
        signal?: AbortSignal,
    ): Promise<EmbedMetadata> {
        const p = parsePath(url);
        if (!p) throw new Error('threads: not a post URL');
        const canonical = canonicalFor(p);
        const pathUser = p.form === 'post' ? p.user : undefined;

        const postId = await this.resolvePostId(url.pathname, signal);
        const post = postId ? await this.fetchPost(postId, signal) : undefined;

        if (!post) {
            // Reachable but no data (private/deleted/blocked): an honest text embed
            // beats a bare redirect — mirrors twitter.ts's tombstone degrade.
            return this.linkCard({
                title: pathUser ? `@${pathUser}` : 'Threads',
                description:
                    "This Threads post couldn't be loaded (private, deleted, or blocked).",
                siteName: 'Threads',
                themeColor: '#000000',
                ttlSeconds: 600,
                originalUrl: canonical,
            });
        }

        const username = post.user?.username ?? pathUser ?? 'threads';
        const descParts: string[] = [];
        const captionText = (post.caption?.text ?? '').trim();
        if (captionText) descParts.push(Text.truncate(captionText, 300));

        let media = pickMedia(post);
        const carousel = post.carousel_media;
        // A carousel is the gallery signal regardless of any top-level cover: use
        // the first child for media when the post itself exposes none, and always
        // mark the count so the "N images" hint isn't dropped when a cover exists.
        if (carousel && carousel.length > 0) {
            if (media.kind === 'link') media = pickMedia(carousel[0]!);
            if (carousel.length > 1) descParts.push(`📷 ${carousel.length}`);
        }

        const hasMedia = media.kind === 'video' || media.kind === 'image';
        return {
            kind: media.kind,
            title: `${username} on Threads`,
            description: descParts.length ? descParts.join(' ') : undefined,
            author: {
                name: `@${username}`,
                url: `https://www.threads.com/@${username}`,
            },
            siteName: 'Threads',
            themeColor: '#000000',
            image: media.image,
            video: media.video,
            nsfw: false,
            ttlSeconds: hasMedia ? MEDIA_TTL_SECONDS : undefined,
            originalUrl: canonical,
        };
    }

    // Step 1: resolve the URL path to the numeric post id via bulk-route.
    private async resolvePostId(
        pathname: string,
        signal?: AbortSignal,
    ): Promise<string | undefined> {
        const cfg = this.config.threads;
        const res = await this.http.fetch(ROUTE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': FIREFOX_UA,
                'X-FB-LSD': cfg.lsd,
                'X-ASBD-ID': ASBD_ID,
                'Sec-Fetch-Site': 'same-origin',
            },
            // Built as a raw string to match Meta's documented wire format byte-for-
            // byte: URLSearchParams would percent-encode the `route_urls[0]` key.
            body:
                `route_urls[0]=${encodeURIComponent(pathname)}` +
                `&__a=1&__comet_req=29&lsd=${encodeURIComponent(cfg.lsd)}`,
            signal,
        });
        if (!res.ok) throw new Error(`threads route ${res.status}`);
        const text = await res.text();
        // Response is prefixed with the `for (;;);` XSS guard — strip it before JSON.
        const body = text.startsWith('for (;;);') ? text.slice(9) : text;
        // Meta bot-blocks the anonymous route call the same way as GraphQL — a 200
        // text/html challenge instead of JSON. Degrade to the informative card
        // (postId undefined → resolve() emits it) rather than throwing on the parse.
        let json: RouteResponse;
        try {
            json = JSON.parse(body) as RouteResponse;
        } catch {
            return undefined;
        }
        const result = json.payload?.payloads?.[pathname]?.result;
        const postId =
            result?.exports?.rootView?.props?.post_id ??
            result?.redirect_result?.exports?.rootView?.props?.post_id;
        if (!postId)
            throw new Error('threads: post_id not found in route definitions');
        return postId;
    }

    // Step 2: fetch the post payload via GraphQL.
    private async fetchPost(
        postId: string,
        signal?: AbortSignal,
    ): Promise<ThreadsPost | undefined> {
        const cfg = this.config.threads;
        const res = await this.http.fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': FIREFOX_UA,
                'X-FB-Friendly-Name': cfg.friendlyName,
                'X-IG-App-ID': cfg.appId,
                'X-FB-LSD': cfg.lsd,
                'X-ASBD-ID': ASBD_ID,
            },
            body: new URLSearchParams({
                lsd: cfg.lsd,
                variables: JSON.stringify({postID: postId}),
                doc_id: cfg.docId,
            }).toString(),
            signal,
        });
        if (!res.ok) throw new Error(`threads graphql ${res.status}`);
        // Meta bot-blocks anonymous GraphQL from many IPs by returning an HTML
        // challenge page (200, text/html) instead of JSON. Treat that as "couldn't
        // load" → the informative degrade embed, not a hard throw.
        let json: GraphqlResponse;
        try {
            json = (await res.json()) as GraphqlResponse;
        } catch {
            return undefined;
        }
        const items = json.data?.data?.containing_thread?.thread_items ?? [];
        // Take the last item that actually carries a post (replies/tombstones drop in).
        for (let i = items.length - 1; i >= 0; i--) {
            const post = items[i]?.post;
            if (post) return post;
        }
        return undefined;
    }
}
