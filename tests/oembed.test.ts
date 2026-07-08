import {describe, expect, test} from 'bun:test';
import OembedRenderer from '@/render/OembedRenderer';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const meta: EmbedMetadata = {
    kind: 'video',
    title: 'T',
    author: {name: 'someone', url: 'https://example.com/someone'},
    siteName: 'Reddit • r/pics',
    originalUrl: 'https://www.reddit.com/x',
};

describe('OembedRenderer', () => {
    test('carries author and provider fields', () => {
        const o = new OembedRenderer().render(meta, 'https://fixem.be');
        expect(o).toEqual({
            version: '1.0',
            type: 'link',
            title: 'T',
            author_name: 'someone',
            author_url: 'https://example.com/someone',
            provider_name: 'Reddit • r/pics',
            provider_url: 'https://fixem.be',
        });
    });

    test('omits author fields when absent', () => {
        const o = new OembedRenderer().render(
            {...meta, author: undefined},
            'https://fixem.be',
        );
        expect('author_name' in o).toBe(false);
        expect('author_url' in o).toBe(false);
    });
});
