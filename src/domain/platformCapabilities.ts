import type EmbedMetadata from '@/domain/EmbedMetadata';

export interface PlatformCapability {
    name: string;
    video: boolean;
    gallery: boolean;
    image: boolean;
    needsCookie: boolean; // requires an operator-supplied session cookie
    degradesTo: EmbedMetadata['kind']; // fallback card kind when media can't be resolved
}

/**
 * Hand-maintained capability flags per platform (adapters don't self-describe).
 * Keep in sync with the adapters and the `platforms` OpenAPI schema. `needsCookie`
 * reflects an operator credential requirement (Instagram), not per-request auth.
 */
export const PLATFORM_CAPABILITIES: PlatformCapability[] = [
    {name: 'reddit', video: true, gallery: true, image: true, needsCookie: false, degradesTo: 'image'},
    {name: 'bluesky', video: true, gallery: true, image: true, needsCookie: false, degradesTo: 'link'},
    {name: 'twitter', video: true, gallery: true, image: true, needsCookie: false, degradesTo: 'link'},
    {name: 'twitch', video: true, gallery: false, image: true, needsCookie: false, degradesTo: 'link'},
    {name: 'threads', video: false, gallery: false, image: true, needsCookie: false, degradesTo: 'link'},
    {name: 'tiktok', video: true, gallery: true, image: true, needsCookie: false, degradesTo: 'link'},
    {name: 'instagram', video: true, gallery: true, image: true, needsCookie: true, degradesTo: 'link'},
];
