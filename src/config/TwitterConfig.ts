import {SYNDICATION_FEATURES} from '@/config/defaults';
import {getEnvString, type Env} from '@/config/env';

export default class TwitterConfig {
    readonly syndicationFeatures!: string;

    static fromEnv(env: Env): TwitterConfig {
        return Object.assign(new TwitterConfig(), {
            syndicationFeatures: getEnvString(
                env,
                'TWITTER_SYNDICATION_FEATURES',
                SYNDICATION_FEATURES,
            ),
        });
    }
}
