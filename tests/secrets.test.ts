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

test('bearer parses the token case-insensitively and tolerates extra whitespace', () => {
    expect(Secrets.bearer('Bearer abc')).toBe('abc');
    expect(Secrets.bearer('bearer abc')).toBe('abc');
    expect(Secrets.bearer('BEARER abc')).toBe('abc');
    expect(Secrets.bearer('Bearer    abc')).toBe('abc');
});

test('bearer returns empty for a missing, empty, or non-bearer header', () => {
    expect(Secrets.bearer(undefined)).toBe('');
    expect(Secrets.bearer(null)).toBe('');
    expect(Secrets.bearer('')).toBe('');
    expect(Secrets.bearer('Basic abc')).toBe('');
    expect(Secrets.bearer('Bearer')).toBe('');
});
