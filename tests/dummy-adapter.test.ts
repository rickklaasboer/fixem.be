import {describe, it, expect} from 'bun:test';
import DummyAdapter from '@/adapters/DummyAdapter';
import type EmbedMetadata from '@/domain/EmbedMetadata';

describe('DummyAdapter', () => {
    const adapter = new DummyAdapter();

    it('matches example.com', () => {
        expect(adapter.match(new URL('https://example.com/some-page'))).toBe(
            true,
        );
    });

    it('matches www.example.com', () => {
        expect(
            adapter.match(new URL('https://www.example.com/some-page')),
        ).toBe(true);
    });

    it('does not match other hosts', () => {
        expect(adapter.match(new URL('https://example.org/some-page'))).toBe(
            false,
        );
        expect(adapter.match(new URL('https://notexample.com/some-page'))).toBe(
            false,
        );
    });

    it('canonicalizes URLs correctly', () => {
        expect(
            adapter.canonicalize(new URL('https://www.example.com/page')),
        ).toBe('https://example.com/page');

        expect(adapter.canonicalize(new URL('https://example.com/page/'))).toBe(
            'https://example.com/page',
        );

        expect(adapter.canonicalize(new URL('https://example.com/'))).toBe(
            'https://example.com/',
        );

        expect(adapter.canonicalize(new URL('https://example.com'))).toBe(
            'https://example.com/',
        );
    });

    it('resolves to expected embed metadata shape', async () => {
        const url = new URL('https://example.com/test');
        const metadata: EmbedMetadata = await adapter.resolve(url);

        expect(metadata.kind).toBe('image');
        expect(metadata.title).toBe('fixem.be works! 🎉');
        expect(metadata.description).toContain('This is the dummy adapter');
        expect(metadata.author?.name).toBe('fixem.be');
        expect(metadata.author?.url).toBe('https://fixem.be');
        expect(metadata.siteName).toBe('example.com');
        expect(metadata.themeColor).toBe('#5865F2');
        expect(metadata.image?.url).toContain('placehold.co');
        expect(metadata.image?.width).toBe(1200);
        expect(metadata.image?.height).toBe(630);
        expect(metadata.originalUrl).toBe('https://example.com/test');
    });

    it('uses canonicalized URL in originalUrl', async () => {
        const url = new URL('https://www.example.com/page/');
        const metadata: EmbedMetadata = await adapter.resolve(url);

        expect(metadata.originalUrl).toBe('https://example.com/page');
    });
});
