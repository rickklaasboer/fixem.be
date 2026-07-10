import {DEFAULT_PROXY_ALLOWLIST} from '@/config/defaults';
import {getEnvIntMin, getEnvList, getEnvString, type Env} from '@/config/env';

export default class ProxyConfig {
    readonly secret!: string;
    readonly hostAllowlist!: string[];
    readonly maxConcurrent!: number;
    readonly maxBytes!: number;
    readonly timeoutMs!: number;

    static fromEnv(env: Env): ProxyConfig {
        return Object.assign(new ProxyConfig(), {
            secret: getEnvString(env, 'PROXY_SECRET', ''),
            hostAllowlist: getEnvList(
                env,
                'PROXY_HOST_ALLOWLIST',
                DEFAULT_PROXY_ALLOWLIST,
            ).map((s) => s.toLowerCase()),
            maxConcurrent: getEnvIntMin(env, 'PROXY_MAX_CONCURRENT', 32, 1),
            maxBytes: getEnvIntMin(env, 'PROXY_MAX_BYTES', 104857600, 1),
            timeoutMs: getEnvIntMin(env, 'PROXY_TIMEOUT_MS', 10000, 100),
        });
    }
}
