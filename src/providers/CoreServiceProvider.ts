import ServiceProvider from '@/providers/ServiceProvider';
import Logger from '@/services/Logger';
import HttpClient from '@/services/HttpClient';
import AppConfig from '@/config/AppConfig';
import ResolverConfig from '@/config/ResolverConfig';

/** Foundational leaves + app-wide config every layer may need. */
export default class CoreServiceProvider extends ServiceProvider {
    register(): void {
        this.app.registerInstance(Logger, new Logger());
        this.app.registerInstance(HttpClient, new HttpClient());
        this.app.registerInstance(AppConfig, AppConfig.fromEnv(this.env));
        this.app.registerInstance(
            ResolverConfig,
            ResolverConfig.fromEnv(this.env),
        );
    }
}
