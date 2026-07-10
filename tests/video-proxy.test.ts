import {expect, test} from 'bun:test';
import VideoProxy from '@/services/proxy/VideoProxy';
import ProxySigner from '@/services/proxy/ProxySigner';
import Clock from '@/services/Clock';
import Logger from '@/services/Logger';
import ProxyConfig from '@/config/ProxyConfig';
import AppConfig from '@/config/AppConfig';
import type EmbedMetadata from '@/domain/EmbedMetadata';

const clock = {now: () => 1000} as Clock;
const logger = new Logger({write() {}});

function makeVp(
    cfg: {secret: string; hostAllowlist: string[]},
    signer: ProxySigner = new ProxySigner(),
): VideoProxy {
    const proxy = Object.assign(new ProxyConfig(), {
        secret: cfg.secret,
        hostAllowlist: cfg.hostAllowlist,
        maxConcurrent: 32,
        maxBytes: 104857600,
        timeoutMs: 10000,
    });
    const app = Object.assign(new AppConfig(), {
        port: 3000,
        publicBaseUrl: 'https://fixem.be',
        extraCrawlerUas: [],
    });
    return new VideoProxy(proxy, app, signer, clock, logger);
}

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
    const out = await makeVp({secret: '', hostAllowlist: []}).rewrite(base);
    expect(out.video).toBeUndefined();
    expect(out.kind).toBe('link');
});

test('drops when host not allowlisted', async () => {
    const out = await makeVp({
        secret: 's',
        hostAllowlist: ['example.com'],
    }).rewrite(base);
    expect(out.video).toBeUndefined();
});

test('rewrites to a signed /v/ url when allowlisted', async () => {
    const out = await makeVp({
        secret: 's',
        hostAllowlist: ['twimg.com'],
    }).rewrite(base);
    expect(out.video?.url.startsWith('https://fixem.be/v/')).toBe(true);
    expect(out.video && 'proxyHeaders' in out.video).toBe(false);
});

test('signedUrlFor returns a signed /v/ URL for an allowlisted https host', async () => {
    const vp = makeVp({secret: 's', hostAllowlist: ['twimg.com']});
    const url = await vp.signedUrlFor(base.video!);
    expect(url?.startsWith('https://fixem.be/v/')).toBe(true);
});

test('signedUrlFor returns null when disabled / not allowlisted / no headers', async () => {
    const signer = new ProxySigner();
    expect(
        await makeVp(
            {secret: '', hostAllowlist: ['twimg.com']},
            signer,
        ).signedUrlFor(base.video!),
    ).toBeNull();

    expect(
        await makeVp(
            {secret: 's', hostAllowlist: ['example.com']},
            signer,
        ).signedUrlFor(base.video!),
    ).toBeNull();

    expect(
        await makeVp(
            {secret: 's', hostAllowlist: ['twimg.com']},
            signer,
        ).signedUrlFor({
            url: 'https://video.twimg.com/x.mp4',
            mimeType: 'video/mp4',
        }),
    ).toBeNull(); // no proxyHeaders → nothing to sign
});

test('passes through metadata with no proxyHeaders unchanged', async () => {
    const m: EmbedMetadata = {
        ...base,
        video: {url: 'https://x/y.mp4', mimeType: 'video/mp4'},
    };
    const out = await makeVp({
        secret: 's',
        hostAllowlist: ['twimg.com'],
    }).rewrite(m);
    expect(out).toEqual(m);
});
