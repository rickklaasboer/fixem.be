import {describe, expect, test} from 'bun:test';
import Logger from '@/services/Logger';

describe('logger', () => {
    test('writes one JSON line with level, msg, fields, time', () => {
        const lines: string[] = [];
        const log = new Logger({write: (l) => void lines.push(l)});
        log.info({platform: 'reddit', cache: 'hit'}, 'resolved');
        expect(lines.length).toBe(1);
        const parsed = JSON.parse(lines[0]!);
        expect(parsed.level).toBe('info');
        expect(parsed.msg).toBe('resolved');
        expect(parsed.platform).toBe('reddit');
        expect(typeof parsed.time).toBe('string');
        expect(lines[0]!.endsWith('\n')).toBe(true);
    });

    test('warn and error levels', () => {
        const lines: string[] = [];
        const log = new Logger({write: (l) => void lines.push(l)});
        log.warn({}, 'w');
        log.error({}, 'e');
        expect(JSON.parse(lines[0]!).level).toBe('warn');
        expect(JSON.parse(lines[1]!).level).toBe('error');
    });
});
