import {expect, test} from 'bun:test';
import Clock from '@/services/Clock';

test('now returns a millisecond timestamp', () => {
    const before = Date.now();
    const n = new Clock().now();
    expect(n).toBeGreaterThanOrEqual(before);
});
