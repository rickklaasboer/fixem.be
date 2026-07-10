import {TIKTOK_DEFAULTS} from '@/config/defaults';
import {getEnvString, type Env} from '@/config/env';

export default class TiktokConfig {
    readonly rehydrationScriptId!: string;
    readonly mobileApiHost!: string;
    readonly iid!: string;
    readonly deviceId!: string;

    static fromEnv(env: Env): TiktokConfig {
        return Object.assign(new TiktokConfig(), {
            rehydrationScriptId: getEnvString(
                env,
                'TIKTOK_REHYDRATION_SCRIPT_ID',
                TIKTOK_DEFAULTS.rehydrationScriptId,
            ),
            mobileApiHost: getEnvString(
                env,
                'TIKTOK_MOBILE_API_HOST',
                TIKTOK_DEFAULTS.mobileApiHost,
            ),
            iid: getEnvString(env, 'TIKTOK_IID', TIKTOK_DEFAULTS.iid),
            deviceId: getEnvString(
                env,
                'TIKTOK_DEVICE_ID',
                TIKTOK_DEFAULTS.deviceId,
            ),
        });
    }
}
