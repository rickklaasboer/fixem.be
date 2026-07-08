import {singleton} from 'tsyringe';
import type EmbedMetadata from '@/domain/EmbedMetadata';

/**
 * Renders oEmbed JSON for Discord link previews.
 * Discord reads author_name/provider_name for the small byline
 * above the embed. provider_name carries the platform branding;
 * provider_url points home. type is always "link": we are not
 * giving Discord embeddable iframe HTML, just byline metadata.
 */
@singleton()
export default class OembedRenderer {
    render(
        meta: EmbedMetadata,
        publicBaseUrl: string,
    ): Record<string, unknown> {
        return {
            version: '1.0',
            type: 'link',
            title: meta.title,
            ...(meta.author ? {author_name: meta.author.name} : {}),
            ...(meta.author?.url ? {author_url: meta.author.url} : {}),
            provider_name: meta.siteName,
            provider_url: publicBaseUrl,
        };
    }
}
