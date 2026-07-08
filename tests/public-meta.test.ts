import {expect, test} from 'bun:test';
import PublicMetaRenderer from '@/render/PublicMetaRenderer';
import VideoProxy from '@/services/proxy/VideoProxy';
import ProxySigner from '@/services/proxy/ProxySigner';
import Clock from '@/services/Clock';
import Logger from '@/services/Logger';
import type Config from '@/config/Config';
import type ResolveOutcome from '@/domain/ResolveOutcome';

const clock = {now: () => 1000} as Clock;
const logger = new Logger({write() {}});

function renderer(cfg: Partial<Config> = {}): PublicMetaRenderer {
    const config = {
        proxySecret: 's',
        proxyHostAllowlist: ['tiktokcdn.com'],
        publicBaseUrl: 'https://fixem.be',
        ...cfg,
    } as unknown as Config;
    return new PublicMetaRenderer(
        new VideoProxy(config, new ProxySigner(), clock, logger),
    );
}

const okVideo: ResolveOutcome = {
    status: 'ok',
    platform: 'tiktok',
    canonicalUrl: 'https://www.tiktok.com/@x/video/1',
    cacheHit: true,
    meta: {
        kind: 'video',
        title: 'vid',
        siteName: 'TikTok',
        originalUrl: 'https://www.tiktok.com/@x/video/1',
        ttlSeconds: 300,
        video: {
            url: 'https://v16.tiktokcdn.com/a.mp4',
            mimeType: 'video/mp4',
            proxyHeaders: {Referer: 'https://www.tiktok.com/'},
        },
    },
};

test('ok: flattens meta, derives needsProxy, never leaks proxyHeaders or ttlSeconds', async () => {
    const out = await renderer().toPublic(okVideo, {proxied: false});
    expect(out.status).toBe('ok');
    expect(out.platform).toBe('tiktok');
    expect(out.canonicalUrl).toBe('https://www.tiktok.com/@x/video/1');
    expect(out.cacheHit).toBe(true);
    expect(out.kind).toBe('video');
    expect(out.video?.url).toBe('https://v16.tiktokcdn.com/a.mp4'); // raw, always
    expect(out.video?.needsProxy).toBe(true);
    expect(out.video?.playableUrl).toBeUndefined(); // not proxied
    const json = JSON.stringify(out);
    expect(json).not.toContain('proxyHeaders');
    expect(json).not.toContain('Referer');
    expect(json).not.toContain('ttlSeconds');
});

test('proxied: attaches a signed playableUrl but keeps the raw url', async () => {
    const out = await renderer().toPublic(okVideo, {proxied: true});
    expect(out.video?.url).toBe('https://v16.tiktokcdn.com/a.mp4');
    expect(out.video?.playableUrl?.startsWith('https://fixem.be/v/')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('proxyHeaders');
});

test('proxied but not allowlisted: playableUrl omitted, never a 403 URL', async () => {
    const out = await renderer({proxyHostAllowlist: ['example.com']}).toPublic(
        okVideo,
        {proxied: true},
    );
    expect(out.video?.playableUrl).toBeUndefined();
    expect(out.video?.needsProxy).toBe(true);
});

test('degraded → link card shape', async () => {
    const out = await renderer().toPublic(
        {
            status: 'degraded',
            platform: 'threads',
            canonicalUrl: 'https://www.threads.net/@x/post/1',
            reason: 'blocked',
        },
        {proxied: false},
    );
    expect(out).toEqual({
        status: 'degraded',
        platform: 'threads',
        canonicalUrl: 'https://www.threads.net/@x/post/1',
        reason: 'blocked',
        kind: 'link',
    });
});

test('no-adapter → platform none', async () => {
    const out = await renderer().toPublic(
        {status: 'no-adapter'},
        {proxied: false},
    );
    expect(out).toEqual({status: 'no-adapter', platform: 'none'});
});
