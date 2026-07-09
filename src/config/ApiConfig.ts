import {getEnvIntMin, getEnvList, type Env} from '@/config/env';

export default class ApiConfig {
    readonly keys!: string[];
    readonly rateLimitPerMin!: number;
    readonly batchMaxUrls!: number;

    static fromEnv(env: Env): ApiConfig {
        return Object.assign(new ApiConfig(), {
            // API keys are case-sensitive — do NOT lowercase.
            keys: getEnvList(env, 'API_KEYS'),
            rateLimitPerMin: getEnvIntMin(env, 'API_RATE_LIMIT_PER_MIN', 60, 1),
            batchMaxUrls: getEnvIntMin(env, 'BATCH_MAX_URLS', 20, 1),
        });
    }
}
