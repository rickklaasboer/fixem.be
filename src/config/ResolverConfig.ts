import {getEnvIntMin, type Env} from '@/config/env';

export default class ResolverConfig {
    readonly resolveTimeoutMs!: number;
    readonly cacheTtlSeconds!: number;

    static fromEnv(env: Env): ResolverConfig {
        return Object.assign(new ResolverConfig(), {
            resolveTimeoutMs: getEnvIntMin(env, 'RESOLVE_TIMEOUT_MS', 5000, 100),
            cacheTtlSeconds: getEnvIntMin(env, 'CACHE_TTL_SECONDS', 14400, 1),
        });
    }
}
