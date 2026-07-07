export type FetchFn = typeof fetch;

export interface EmbedMetadata {
  kind: "video" | "image" | "gallery" | "link";
  title: string;
  description?: string;
  author?: { name: string; url?: string };
  siteName: string;
  themeColor?: string;
  image?: { url: string; width?: number; height?: number };
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
  resolve(url: URL): Promise<EmbedMetadata>;
}
