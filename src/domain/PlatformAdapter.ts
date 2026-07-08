import type EmbedMetadata from '@/domain/EmbedMetadata';

/**
 * A platform adapter: pure URL → EmbedMetadata factory. Adapters throw on
 * failure (the resolver degrades); reachable-but-refused returns a link card.
 */
export default interface PlatformAdapter {
    name: string;
    match(url: URL): boolean;
    canonicalize(url: URL): string;
    resolve(url: URL, signal?: AbortSignal): Promise<EmbedMetadata>;
}
