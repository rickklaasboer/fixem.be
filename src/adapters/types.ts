export type FetchFn = typeof fetch;

export interface EmbedMetadata {
  kind: "video" | "image" | "gallery" | "link";
  title: string;
  description?: string;
  author?: { name: string; url?: string };
  siteName: string;
  themeColor?: string;
  image?: { url: string; width?: number; height?: number };
  video?: { url: string; width?: number; height?: number; mimeType: string };
  nsfw?: boolean;
  originalUrl: string;
}

export interface PlatformAdapter {
  name: string;
  match(url: URL): boolean;
  canonicalize(url: URL): string;
  resolve(url: URL): Promise<EmbedMetadata>;
}
