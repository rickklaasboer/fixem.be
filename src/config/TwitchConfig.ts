import {TWITCH_GQL_DEFAULTS} from '@/config/defaults';
import {getEnvString, type Env} from '@/config/env';

export default class TwitchConfig {
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly gqlClientId!: string;
    readonly gqlClipHash!: string;

    /** Helix path is enabled only when both credentials are present. */
    get enabled(): boolean {
        return !!this.clientId && !!this.clientSecret;
    }

    static fromEnv(env: Env): TwitchConfig {
        return Object.assign(new TwitchConfig(), {
            clientId: getEnvString(env, 'TWITCH_CLIENT_ID') ?? undefined,
            clientSecret: getEnvString(env, 'TWITCH_CLIENT_SECRET') ?? undefined,
            gqlClientId: getEnvString(
                env,
                'TWITCH_GQL_CLIENT_ID',
                TWITCH_GQL_DEFAULTS.clientId,
            ),
            gqlClipHash: getEnvString(
                env,
                'TWITCH_GQL_CLIP_HASH',
                TWITCH_GQL_DEFAULTS.clipTokenHash,
            ),
        });
    }
}
