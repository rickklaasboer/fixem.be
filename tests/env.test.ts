import {describe, expect, test} from 'bun:test';
import {
    getEnvString,
    getEnvInt,
    getEnvIntMin,
    getEnvBool,
    getEnvList,
} from '@/config/env';

describe('env helpers', () => {
    test('getEnvString: empty string counts as absent (|| semantics)', () => {
        expect(getEnvString({}, 'X')).toBeUndefined();
        expect(getEnvString({X: ''}, 'X', 'def')).toBe('def');
        expect(getEnvString({X: 'v'}, 'X', 'def')).toBe('v');
        expect(getEnvString({}, 'X', 'def')).toBe('def');
    });

    test('getEnvInt: radix 10, non-numeric falls back', () => {
        expect(getEnvInt({X: '42'}, 'X', 7)).toBe(42);
        expect(getEnvInt({X: 'banana'}, 'X', 7)).toBe(7);
        expect(getEnvInt({}, 'X')).toBeUndefined();
    });

    test('getEnvIntMin: sub-floor value falls back to default', () => {
        expect(getEnvIntMin({X: '0'}, 'X', 60, 1)).toBe(60);
        expect(getEnvIntMin({X: '-3'}, 'X', 20, 1)).toBe(20);
        expect(getEnvIntMin({X: '120'}, 'X', 60, 1)).toBe(120);
    });

    test('getEnvBool: widened truthy/falsy set', () => {
        for (const v of ['1', 'on', 'yes', 'true', 'TRUE']) {
            expect(getEnvBool({X: v}, 'X', false)).toBe(true);
        }
        for (const v of ['0', 'off', 'no', 'false']) {
            expect(getEnvBool({X: v}, 'X', true)).toBe(false);
        }
        expect(getEnvBool({}, 'X', false)).toBe(false);
    });

    test('getEnvList: split/trim/drop-empties, default when absent', () => {
        expect(getEnvList({X: 'a, b ,,c'}, 'X')).toEqual(['a', 'b', 'c']);
        expect(getEnvList({}, 'X')).toEqual([]);
        expect(getEnvList({X: ''}, 'X', ['d'])).toEqual(['d']);
    });
});
