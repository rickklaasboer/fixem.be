import {getEnvString, type Env} from '@/config/env';

export default class RedisConfig {
    readonly url!: string;

    static fromEnv(env: Env): RedisConfig {
        return Object.assign(new RedisConfig(), {
            url: getEnvString(env, 'REDIS_URL', 'redis://localhost:6379'),
        });
    }
}
