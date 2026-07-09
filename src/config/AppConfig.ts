import {getEnvIntMin, getEnvList, getEnvString, type Env} from '@/config/env';

export default class AppConfig {
    readonly port!: number;
    readonly publicBaseUrl!: string;
    readonly extraCrawlerUas!: string[];

    static fromEnv(env: Env): AppConfig {
        return Object.assign(new AppConfig(), {
            port: getEnvIntMin(env, 'PORT', 3000, 1),
            publicBaseUrl: getEnvString(
                env,
                'PUBLIC_BASE_URL',
                'https://fixem.be',
            ),
            extraCrawlerUas: getEnvList(env, 'EXTRA_CRAWLER_UAS').map((s) =>
                s.toLowerCase(),
            ),
        });
    }
}
