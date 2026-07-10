import {getEnvString, type Env} from '@/config/env';

export default class RedditConfig {
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly proxyUrl?: string;
    readonly httpProxy?: string;

    static fromEnv(env: Env): RedditConfig {
        return Object.assign(new RedditConfig(), {
            clientId: getEnvString(env, 'REDDIT_CLIENT_ID') ?? undefined,
            clientSecret:
                getEnvString(env, 'REDDIT_CLIENT_SECRET') ?? undefined,
            proxyUrl: getEnvString(env, 'REDDIT_PROXY_URL') ?? undefined,
            httpProxy: getEnvString(env, 'REDDIT_HTTP_PROXY') ?? undefined,
        });
    }
}
