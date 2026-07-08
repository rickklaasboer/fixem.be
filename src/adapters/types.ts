export type FetchFn = typeof fetch;

export interface EmbedMetadata {
    kind: 'video' | 'image' | 'gallery' | 'link';
    title: string;
    description?: string;
    author?: {name: string; url?: string};
    siteName: string;
    themeColor?: string;
    image?: {url: string; width?: number; height?: number};
    video?: {
        url: string;
        width?: number;
        height?: number;
        mimeType: string;
        // When set, the app rewrites `url` to a signed /v/ proxy URL carrying these
        // request headers (the CDN needs them; Discord won't send them).
        proxyHeaders?: Record<string, string>;
    };
    nsfw?: boolean;
    // Optional cache-TTL cap for results whose media URLs expire (e.g. signed
    // CDN links). Consumed by the resolver; never rendered.
    ttlSeconds?: number;
    originalUrl: string;
}

export interface PlatformAdapter {
    name: string;
    match(url: URL): boolean;
    canonicalize(url: URL): string;
    // `signal` (when the resolver supplies one) aborts every in-flight fetch this
    // resolve makes if the per-resolve timeout fires — adapters thread it into
    // their fetch calls via withSignal(). Optional so simple adapters can ignore it.
    resolve(url: URL, signal?: AbortSignal): Promise<EmbedMetadata>;
}
