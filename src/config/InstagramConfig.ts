import {INSTAGRAM_DEFAULTS} from '@/config/defaults';
import {getEnvBool, getEnvString, type Env} from '@/config/env';

export default class InstagramConfig {
    readonly docId!: string;
    readonly appId!: string;
    readonly friendlyName!: string;
    readonly proxyUrl?: string;
    readonly cookie?: string;
    readonly snapsave!: boolean;

    static fromEnv(env: Env): InstagramConfig {
        return Object.assign(new InstagramConfig(), {
            docId: getEnvString(
                env,
                'INSTAGRAM_DOC_ID',
                INSTAGRAM_DEFAULTS.docId,
            ),
            appId: getEnvString(
                env,
                'INSTAGRAM_APP_ID',
                INSTAGRAM_DEFAULTS.appId,
            ),
            friendlyName: getEnvString(
                env,
                'INSTAGRAM_FRIENDLY_NAME',
                INSTAGRAM_DEFAULTS.friendlyName,
            ),
            proxyUrl: getEnvString(env, 'INSTAGRAM_PROXY_URL') ?? undefined,
            cookie: getEnvString(env, 'INSTAGRAM_COOKIE') ?? undefined,
            snapsave: getEnvBool(env, 'INSTAGRAM_SNAPSAVE', false),
        });
    }
}
