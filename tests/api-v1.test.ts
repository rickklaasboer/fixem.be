import {describe, expect, test} from 'bun:test';
import {PLATFORM_CAPABILITIES} from '@/domain/platformCapabilities';

describe('platformCapabilities', () => {
    test('covers the real platforms with the documented flag shape', () => {
        const byName = Object.fromEntries(
            PLATFORM_CAPABILITIES.map((p) => [p.name, p]),
        );
        for (const name of [
            'reddit',
            'bluesky',
            'twitter',
            'twitch',
            'threads',
            'tiktok',
            'instagram',
        ]) {
            expect(byName[name]).toBeDefined();
        }
        expect(byName.instagram!.needsCookie).toBe(true);
        expect(byName.threads!.video).toBe(false);
        // every row is fully specified (no missing flags)
        for (const p of PLATFORM_CAPABILITIES) {
            expect(typeof p.video).toBe('boolean');
            expect(typeof p.gallery).toBe('boolean');
            expect(typeof p.image).toBe('boolean');
            expect(typeof p.needsCookie).toBe('boolean');
            expect(['video', 'image', 'gallery', 'link']).toContain(
                p.degradesTo,
            );
        }
    });
});
