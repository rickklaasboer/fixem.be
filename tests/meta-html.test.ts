import {describe, expect, test} from 'bun:test';
import MetaHtmlRenderer from '@/render/MetaHtmlRenderer';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const r = new MetaHtmlRenderer();

const base: EmbedMetadata = {
    kind: 'image',
    title: 'A post',
    description: 'Hello <world> & "friends"',
    author: {name: 'u/someone', url: 'https://example.com/u/someone'},
    siteName: 'Reddit • r/pics',
    themeColor: '#FF4500',
    image: {url: 'https://i.example.com/a.jpg', width: 1200, height: 800},
    originalUrl: 'https://www.reddit.com/r/pics/comments/abc',
};

describe('renderMetaHtml', () => {
    test('image post has OG + twitter tags and oembed link', () => {
        const html = r.render(base, {
            oembedUrl: 'https://fixem.be/oembed?url=x',
        });
        expect(html).toContain('<meta property="og:title" content="A post"');
        expect(html).toContain(
            '<meta property="og:site_name" content="Reddit • r/pics"',
        );
        expect(html).toContain(
            '<meta property="og:image" content="https://i.example.com/a.jpg"',
        );
        expect(html).toContain(
            '<meta property="og:image:width" content="1200"',
        );
        expect(html).toContain(
            '<meta name="twitter:card" content="summary_large_image"',
        );
        expect(html).toContain('<meta name="theme-color" content="#FF4500"');
        expect(html).toContain(
            '<meta property="og:url" content="https://www.reddit.com/r/pics/comments/abc"',
        );
        expect(html).toContain('type="application/json+oembed"');
        expect(html).toContain('<meta http-equiv="refresh"');
    });

    test('escapes HTML in attribute values', () => {
        const html = r.render(base, {
            oembedUrl: 'https://fixem.be/oembed?url=x',
        });
        expect(html).toContain('Hello &lt;world&gt; &amp; &quot;friends&quot;');
        expect(html).not.toContain('Hello <world>');
    });

    test('escapes a breakout payload across every interpolated context', () => {
        // Regression guard: the wrapped target (title/originalUrl/siteName/author)
        // is attacker-influenced. A `"><script>` breakout must be neutralised in
        // the <title>, og:url, the meta-refresh content attr, the oembed link
        // title, and the redirect <a href> — every place these values land.
        const payload = '"><script>alert(1)</script>';
        const meta: EmbedMetadata = {
            kind: 'link',
            title: payload,
            siteName: payload,
            author: {name: payload},
            originalUrl: 'https://e.com/"><x',
        };
        const html = r.render(meta, {
            oembedUrl: 'https://fixem.be/oembed?url="><x',
        });
        // No live script and no attribute breakout anywhere in the document.
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('"><');
        // Escaped forms land in each named context.
        expect(html).toContain(
            '<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>',
        );
        expect(html).toContain(
            '<meta property="og:url" content="https://e.com/&quot;&gt;&lt;x">',
        );
        expect(html).toContain(
            '<meta http-equiv="refresh" content="0;url=https://e.com/&quot;&gt;&lt;x">',
        );
        expect(html).toContain(
            'title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
        );
        expect(html).toContain('<a href="https://e.com/&quot;&gt;&lt;x">');
        expect(html).toContain(
            'href="https://fixem.be/oembed?url=&quot;&gt;&lt;x"',
        );
    });

    test('video post uses player card and og:video tags', () => {
        const meta: EmbedMetadata = {
            ...base,
            kind: 'video',
            video: {
                url: 'https://v.example.com/v.mp4',
                width: 720,
                height: 1280,
                mimeType: 'video/mp4',
            },
        };
        const html = r.render(meta, {
            oembedUrl: 'https://fixem.be/oembed?url=x',
        });
        expect(html).toContain(
            '<meta property="og:video" content="https://v.example.com/v.mp4"',
        );
        expect(html).toContain(
            '<meta property="og:video:type" content="video/mp4"',
        );
        expect(html).toContain('<meta name="twitter:card" content="player"');
        expect(html).toContain(
            '<meta name="twitter:player:width" content="720"',
        );
    });

    test('nsfw adds marker to title', () => {
        const html = r.render(
            {...base, nsfw: true},
            {oembedUrl: 'https://fixem.be/oembed?url=x'},
        );
        expect(html).toContain('content="🔞 A post"');
    });

    test('no-media post falls back to summary card, omits image tags', () => {
        const meta: EmbedMetadata = {
            kind: 'link',
            title: 'T',
            siteName: 'S',
            originalUrl: 'https://e.com/x',
        };
        const html = r.render(meta, {
            oembedUrl: 'https://fixem.be/oembed?url=x',
        });
        expect(html).toContain('<meta name="twitter:card" content="summary"');
        expect(html).not.toContain('og:image');
        expect(html).not.toContain('og:video');
    });

    test('minimalMeta builds a link-kind fallback', () => {
        const m = r.minimalMeta('https://www.tiktok.com/@user/video/1');
        expect(m.kind).toBe('link');
        expect(m.title).toBe('https://www.tiktok.com/@user/video/1');
        expect(m.originalUrl).toBe('https://www.tiktok.com/@user/video/1');
        expect(m.siteName).toBe('fixem.be');
    });
});
