import {expect, test} from 'bun:test';
import VideoProxy from '@/services/proxy/VideoProxy';
import ProxySigner from '@/services/proxy/ProxySigner';
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

test('signedUrlFor returns a signed /v/ URL for an allowlisted https host', async () => {
    const cfg = {
        proxySecret: 's',
        proxyHostAllowlist: ['twimg.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    const vp = new VideoProxy(cfg, new ProxySigner(), clock, logger);
    const url = await vp.signedUrlFor(base.video!);
    expect(url?.startsWith('https://fixem.be/v/')).toBe(true);
});

test('signedUrlFor returns null when disabled / not allowlisted / no headers', async () => {
    const signer = new ProxySigner();
    const disabled = {
        proxySecret: '',
        proxyHostAllowlist: ['twimg.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    expect(
        await new VideoProxy(disabled, signer, clock, logger).signedUrlFor(
            base.video!,
        ),
    ).toBeNull();

    const notAllowed = {
        proxySecret: 's',
        proxyHostAllowlist: ['example.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    expect(
        await new VideoProxy(notAllowed, signer, clock, logger).signedUrlFor(
            base.video!,
        ),
    ).toBeNull();

    const enabled = {
        proxySecret: 's',
        proxyHostAllowlist: ['twimg.com'],
        publicBaseUrl: 'https://fixem.be',
    } as unknown as Config;
    expect(
        await new VideoProxy(enabled, signer, clock, logger).signedUrlFor({
            url: 'https://video.twimg.com/x.mp4',
            mimeType: 'video/mp4',
        }),
    ).toBeNull(); // no proxyHeaders → nothing to sign
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
