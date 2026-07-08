import type EmbedMetadata from '@/domain/EmbedMetadata';
import type PlatformAdapter from '@/domain/PlatformAdapter';

/**
 * Shared base for platform adapters. Carries the reachable-but-refused
 * "link card" builder so unavailable/blocked posts return an informative
 * branded embed instead of throwing.
 */
export default abstract class BaseAdapter implements PlatformAdapter {
    abstract name: string;
    abstract match(url: URL): boolean;
    abstract canonicalize(url: URL): string;
    abstract resolve(url: URL, signal?: AbortSignal): Promise<EmbedMetadata>;

    /**
     * Build an informative link-only embed (reachable-but-refused content).
     */
    protected linkCard(f: {
        title: string;
        description?: string;
        siteName: string;
        themeColor?: string;
        ttlSeconds?: number;
        originalUrl: string;
    }): EmbedMetadata {
        return {kind: 'link', ...f};
    }
}
