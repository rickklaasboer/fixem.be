import {describe, expect, test} from 'bun:test';
import ProxySigner, {type ProxyPayload} from '@/services/ProxySigner';

const SECRET = 'test-secret-key';
const payload: ProxyPayload = {
    url: 'https://v16-webapp.tiktok.com/abc.mp4',
    headers: {'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/'},
    exp: 2_000_000,
};

const signer = new ProxySigner();

describe('proxy token', () => {
    test('round-trips a valid token before expiry', async () => {
        const tok = await signer.sign(SECRET, payload);
        const out = await signer.verify(SECRET, tok, 1_000_000);
        expect(out).toEqual(payload);
    });

    test('rejects an expired token', async () => {
        const tok = await signer.sign(SECRET, payload);
        expect(await signer.verify(SECRET, tok, 2_000_001)).toBeNull();
    });

    test('rejects a wrong signature', async () => {
        const tok = await signer.sign(SECRET, payload);
        expect(await signer.verify('other-secret', tok, 1_000_000)).toBeNull();
    });

    test('rejects a tampered payload', async () => {
        const tok = await signer.sign(SECRET, payload);
        const [, sig] = tok.split('.');
        const forged = `${btoa(JSON.stringify({...payload, url: 'https://evil.test/x'}))}.${sig}`;
        expect(await signer.verify(SECRET, forged, 1_000_000)).toBeNull();
    });

    test('rejects malformed tokens', async () => {
        expect(await signer.verify(SECRET, 'garbage', 1_000_000)).toBeNull();
        expect(await signer.verify(SECRET, 'a.b.c', 1_000_000)).toBeNull();
        expect(await signer.verify(SECRET, '', 1_000_000)).toBeNull();
    });
});
