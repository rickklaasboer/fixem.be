import {describe, expect, test} from 'bun:test';
import Snapsave from '@/services/Snapsave';
import HttpClient from '@/services/HttpClient';
import type {FetchFn} from '@/services/HttpClient';

// A real recorded snapsave.app response (a photo post). Guards the obfuscation
// decoder against regressions — if snapsave rotates its scheme, this fails loudly.
const blob = await Bun.file(
    new URL('./fixtures/instagram/snapsave-response.txt', import.meta.url),
).text();

describe('snapsave decoder', () => {
    test('deobfuscates the recorded blob to HTML containing rapidcdn links', () => {
        const html = Snapsave.deobfuscate(blob);
        expect(html).not.toBeNull();
        expect(html!).toContain('d.rapidcdn.app/v2');
    });

    test('parses the recorded blob into a media descriptor', () => {
        const media = Snapsave.parse(blob);
        expect(media).not.toBeNull();
        expect(media!.kind).toBe('image'); // the recorded post is a photo
        expect(
            media!.mediaUrl.startsWith('https://d.rapidcdn.app/v2?token='),
        ).toBe(true);
        expect(media!.count).toBeGreaterThanOrEqual(1);
    });

    test('returns null on a non-snapsave / malformed blob (no crash)', () => {
        expect(Snapsave.parse('<html>totally unrelated</html>')).toBeNull();
        expect(Snapsave.deobfuscate('garbage')).toBeNull();
    });

    test('terminates on a decoder blob whose data never hits the delimiter (no infinite loop)', () => {
        // Matches the outer regex so we enter the decode loop, but h="ABC" never
        // contains the delimiter n[e] = "Y" (n="XY", e=1). Before the `i < len`
        // bound this spun the event loop forever; now it must just return quickly.
        // If this ever regresses, the whole test run hangs on the bun timeout.
        expect(Snapsave.deobfuscate('}("ABC",2,"XY",5,1,3)')).toBeNull();
        expect(Snapsave.parse('}("ABC",2,"XY",5,1,3)')).toBeNull();
    });

    test('fetchMedia POSTs the IG url and parses the response', async () => {
        let seenBody: string | undefined;
        const fetchFn = (async (_input: unknown, init?: RequestInit) => {
            seenBody = init?.body?.toString();
            return new Response(blob, {status: 200});
        }) as unknown as FetchFn;
        const media = await new Snapsave(new HttpClient(fetchFn)).fetchMedia(
            'https://www.instagram.com/p/DaNQAubIQm_/',
        );
        expect(seenBody).toContain(
            encodeURIComponent('https://www.instagram.com/p/DaNQAubIQm_/'),
        );
        expect(media?.mediaUrl).toContain('rapidcdn.app');
    });

    test('fetchMedia forwards the abort signal to the underlying fetch', async () => {
        // On a resolve timeout the fallback must be cancellable like every other
        // adapter fetch — otherwise it runs unbounded past the resolver deadline.
        const controller = new AbortController();
        let seenSignal: AbortSignal | undefined;
        const fetchFn = (async (_input: unknown, init?: RequestInit) => {
            seenSignal = init?.signal ?? undefined;
            return new Response(blob, {status: 200});
        }) as unknown as FetchFn;
        await new Snapsave(new HttpClient(fetchFn)).fetchMedia(
            'https://www.instagram.com/p/x/',
            controller.signal,
        );
        expect(seenSignal).toBe(controller.signal);
    });

    test('fetchMedia returns null on transport failure (no throw)', async () => {
        const boom = (async () => {
            throw new Error('network down');
        }) as unknown as FetchFn;
        expect(
            await new Snapsave(new HttpClient(boom)).fetchMedia(
                'https://www.instagram.com/p/x/',
            ),
        ).toBeNull();
    });
});
