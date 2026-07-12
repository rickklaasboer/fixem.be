import {getEnvIntMin, getEnvList, getEnvString, type Env} from '@/config/env';

export default class UsageConfig {
    readonly dbPath!: string;
    readonly flushIntervalMs!: number;
    readonly adminKeys!: string[];

    static fromEnv(env: Env): UsageConfig {
        return Object.assign(new UsageConfig(), {
            dbPath: getEnvString(env, 'USAGE_DB_PATH', './data/usage.sqlite'),
            // Floor at 1s so an operator typo can't spin the flush loop hot.
            flushIntervalMs: getEnvIntMin(
                env,
                'USAGE_FLUSH_INTERVAL_MS',
                10000,
                1000,
            ),
            // Admin keys are case-sensitive — do NOT lowercase (mirrors API_KEYS).
            adminKeys: getEnvList(env, 'ADMIN_API_KEYS'),
        });
    }
}
