import {getEnvIntMin, type Env} from '@/config/env';

export default class RateLimitConfig {
    readonly perMin!: number;

    static fromEnv(env: Env): RateLimitConfig {
        return Object.assign(new RateLimitConfig(), {
            perMin: getEnvIntMin(env, 'RATE_LIMIT_PER_MIN', 60, 1),
        });
    }
}
