import {describe, expect, test} from 'bun:test';
import {parseTargetUrl} from '../src/url';

function ok(pathname: string, search = '') {
    const r = parseTargetUrl(pathname, search);
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
    return r.url.href;
}

describe('parseTargetUrl', () => {
    test('plain https URL in path', () => {
        expect(ok('/https://www.reddit.com/r/pics/comments/abc/title/')).toBe(
            'https://www.reddit.com/r/pics/comments/abc/title/',
        );
    });

    test('proxy-collapsed single slash is repaired', () => {
        expect(ok('/https:/www.reddit.com/r/pics')).toBe(
            'https://www.reddit.com/r/pics',
        );
    });

    test('query string is re-attached to target', () => {
        expect(ok('/https://www.youtube.com/watch', 'v=abc123')).toBe(
            'https://www.youtube.com/watch?v=abc123',
        );
    });

    test('fixem control param is stripped from target', () => {
        expect(ok('/https://example.com/x', 'fixem=preview&keep=1')).toBe(
            'https://example.com/x?keep=1',
        );
    });

    test('bare host defaults to https', () => {
        expect(ok('/www.tiktok.com/@user/video/123')).toBe(
            'https://www.tiktok.com/@user/video/123',
        );
    });

    test('URL-encoded path decodes once', () => {
        expect(
            ok(
                '/https%3A%2F%2Fbsky.app%2Fprofile%2Fa.bsky.social%2Fpost%2F123',
            ),
        ).toBe('https://bsky.app/profile/a.bsky.social/post/123');
    });

    test('double-encoded input is rejected', () => {
        const r = parseTargetUrl('/https%253A%252F%252Fexample.com%252Fx', '');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('double-encoded');
    });

    test('garbage is unparseable', () => {
        expect(parseTargetUrl('/not a url at all', '').ok).toBe(false);
        expect(parseTargetUrl('/favicon.ico', '').ok).toBe(false);
    });

    test('non-http scheme is rejected', () => {
        const r = parseTargetUrl('/ftp://example.com/file', '');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('bad-scheme');
    });

    test('re-attached params land before the fragment, not inside it', () => {
        expect(ok('/https://example.com/x#section', 'keep=1')).toBe(
            'https://example.com/x?keep=1#section',
        );
    });

    test('bare host without a path segment is unparseable', () => {
        const r = parseTargetUrl('/example.com', '');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('unparseable');
    });
});
