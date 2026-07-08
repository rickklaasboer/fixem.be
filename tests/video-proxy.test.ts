import {expect, test} from 'bun:test';
import VideoProxy from '@/services/VideoProxy';
import ProxySigner from '@/services/ProxySigner';
import Clock from '@/services/Clock';
import Logger from '@/services/Logger';
import type Config from '@/config/Config';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const clock = {now: () => 1000} as Clock;
const logger = new Logger({write() {}});
const base: EmbedMetadata = {
    kind: 'video',
    title: 't',
    siteName: 's',
    originalUrl: 'https://x.test/',
    video: {
        url: 'https://video.twimg.com/x.mp4',
        mimeType: 'video/mp4',
        proxyHeaders: {'X-A': 'b'},
    },
};

test('drops video to link when proxy disabled', async () => {
    const cfg = {
        proxySecret: '',
        proxyHostAllowlist: [],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    const out = await new VideoProxy(
        cfg,
        new ProxySigner(),
        clock,
        logger,
    ).rewrite(base);
    expect(out.video).toBeUndefined();
    expect(out.kind).toBe('link');
});

test('drops when host not allowlisted', async () => {
    const cfg = {
        proxySecret: 's',
        proxyHostAllowlist: ['example.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    const out = await new VideoProxy(
        cfg,
        new ProxySigner(),
        clock,
        logger,
    ).rewrite(base);
    expect(out.video).toBeUndefined();
});

test('rewrites to a signed /v/ url when allowlisted', async () => {
    const cfg = {
        proxySecret: 's',
        proxyHostAllowlist: ['twimg.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    const out = await new VideoProxy(
        cfg,
        new ProxySigner(),
        clock,
        logger,
    ).rewrite(base);
    expect(out.video?.url.startsWith('https://fixem.be/v/')).toBe(true);
    expect(out.video && 'proxyHeaders' in out.video).toBe(false);
});

test('passes through metadata with no proxyHeaders unchanged', async () => {
    const cfg = {
        proxySecret: 's',
        proxyHostAllowlist: ['twimg.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    const m: EmbedMetadata = {
        ...base,
        video: {url: 'https://x/y.mp4', mimeType: 'video/mp4'},
    };
    const out = await new VideoProxy(
        cfg,
        new ProxySigner(),
        clock,
        logger,
    ).rewrite(m);
    expect(out).toEqual(m);
});
