import {describe, expect, test} from 'bun:test';
import AdapterRegistry from '@/domain/AdapterRegistry';
import DummyAdapter from '@/adapters/DummyAdapter';

describe('registry + dummy adapter', () => {
    const registry = new AdapterRegistry([new DummyAdapter()]);

    test('finds adapter by host', () => {
        expect(registry.find(new URL('https://example.com/x'))?.name).toBe(
            'dummy',
        );
        expect(registry.find(new URL('https://www.example.com/x'))?.name).toBe(
            'dummy',
        );
        expect(registry.find(new URL('https://unknown.tld/x'))).toBeUndefined();
    });

    test('dummy canonicalizes by stripping query', () => {
        const a = registry.find(
            new URL('https://example.com/some/path?utm_source=x'),
        )!;
        expect(
            a.canonicalize(
                new URL('https://example.com/some/path?utm_source=x'),
            ),
        ).toBe('https://example.com/some/path');
    });

    test('dummy resolves static metadata without network', async () => {
        const a = registry.find(new URL('https://example.com/hello'))!;
        const meta = await a.resolve(new URL('https://example.com/hello'));
        expect(meta.title).toContain('fixem.be');
        expect(meta.kind).toBe('image');
        expect(meta.siteName).toBe('example.com');
        expect(meta.originalUrl).toBe('https://example.com/hello');
    });
});
