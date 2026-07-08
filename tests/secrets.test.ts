import {expect, test} from 'bun:test';
import Secrets from '@/support/Secrets';

test('match returns true for identical secrets', async () => {
    expect(await Secrets.match('hunter2', 'hunter2')).toBe(true);
});

test('match returns false for different secrets', async () => {
    expect(await Secrets.match('hunter2', 'nope')).toBe(false);
});

test('match returns false when one is empty', async () => {
    expect(await Secrets.match('', 'x')).toBe(false);
});

test('hash returns a stable 64-char hex digest', async () => {
    const h = await Secrets.hash('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await Secrets.hash('abc')).toBe(h);
    expect(await Secrets.hash('abd')).not.toBe(h);
});
