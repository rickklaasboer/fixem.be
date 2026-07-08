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
