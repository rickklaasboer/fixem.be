import {describe, expect, test} from 'bun:test';
import UsageConfig from '@/config/UsageConfig';

describe('UsageConfig', () => {
    test('defaults', () => {
        const d = UsageConfig.fromEnv({});
        expect(d.dbPath).toBe('./data/usage.sqlite');
        expect(d.flushIntervalMs).toBe(10000);
        expect(d.adminKeys).toEqual([]);
    });

    test('parsing + floors + case-sensitive keys', () => {
        const c = UsageConfig.fromEnv({
            USAGE_DB_PATH: '/var/lib/usage.db',
            USAGE_FLUSH_INTERVAL_MS: '500', // below 1000 floor
            ADMIN_API_KEYS: 'Ab1, cD2 ,,eF3',
        });
        expect(c.dbPath).toBe('/var/lib/usage.db');
        expect(c.flushIntervalMs).toBe(10000); // sub-floor falls back
        expect(c.adminKeys).toEqual(['Ab1', 'cD2', 'eF3']);
    });

    test('blank USAGE_DB_PATH falls back (|| rule)', () => {
        expect(UsageConfig.fromEnv({USAGE_DB_PATH: ''}).dbPath).toBe(
            './data/usage.sqlite',
        );
    });
});
