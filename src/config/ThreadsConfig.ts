import {THREADS_DEFAULTS} from '@/config/defaults';
import {getEnvString, type Env} from '@/config/env';

export default class ThreadsConfig {
    readonly lsd!: string;
    readonly docId!: string;
    readonly appId!: string;
    readonly friendlyName!: string;

    static fromEnv(env: Env): ThreadsConfig {
        return Object.assign(new ThreadsConfig(), {
            lsd: getEnvString(env, 'THREADS_LSD', THREADS_DEFAULTS.lsd),
            docId: getEnvString(env, 'THREADS_DOC_ID', THREADS_DEFAULTS.docId),
            appId: getEnvString(env, 'THREADS_APP_ID', THREADS_DEFAULTS.appId),
            friendlyName: getEnvString(
                env,
                'THREADS_FRIENDLY_NAME',
                THREADS_DEFAULTS.friendlyName,
            ),
        });
    }
}
