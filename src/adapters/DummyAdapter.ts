import {injectable} from 'tsyringe';
import BaseAdapter from '@/adapters/BaseAdapter';
import HttpClient from '@/services/HttpClient';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const DUMMY_HOSTS = new Set(['example.com', 'www.example.com']);

/**
 * Static test adapter for example.com — lets us smoke-test embeds
 * end-to-end (including in production Discord) without any platform
 * dependency.
 */
@injectable()
export default class DummyAdapter extends BaseAdapter {
    public name = 'dummy';

    constructor(private http: HttpClient) {
        super();
    }

    public match(url: URL): boolean {
        return DUMMY_HOSTS.has(url.hostname);
    }

    public canonicalize(url: URL): string {
        return `https://example.com${url.pathname.replace(/\/$/, '') || '/'}`;
    }

    /**
     * Resolve example.com to a fixed test embed metadata.
     */
    public async resolve(url: URL): Promise<EmbedMetadata> {
        return {
            kind: 'image',
            title: 'fixem.be works! 🎉',
            description:
                'This is the dummy adapter. If you can read this in an embed, crawler routing, resolving, caching and rendering are all working.',
            author: {name: 'fixem.be', url: 'https://fixem.be'},
            siteName: 'example.com',
            themeColor: '#5865F2',
            image: {
                url: 'https://placehold.co/1200x630/5865F2/ffffff.png?text=fixem.be',
                width: 1200,
                height: 630,
            },
            originalUrl: this.canonicalize(url),
        };
    }
}
