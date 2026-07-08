import {describe, expect, test} from 'bun:test';
import Text from '@/support/Text';

describe('truncate', () => {
    test('short strings pass through trimmed', () => {
        expect(Text.truncate('  hello  ', 300)).toBe('hello');
    });
    test('long strings cut on word boundary with ellipsis', () => {
        const out = Text.truncate('aaa bbb ccc ddd', 11);
        expect(out).toBe('aaa bbb…');
        expect(out.length).toBeLessThanOrEqual(11);
    });
    test('unbreakable strings hard-cut', () => {
        expect(Text.truncate('abcdefghij', 5)).toBe('abcd…');
    });
    test('non-positive max returns empty string', () => {
        expect(Text.truncate('aaaaaaaaaa', 0)).toBe('');
        expect(Text.truncate('aaaaaaaaaa', -3)).toBe('');
    });
});
