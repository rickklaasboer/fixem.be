import ServiceProvider from '@/providers/ServiceProvider';
import ProxyConfig from '@/config/ProxyConfig';
import Logger from '@/services/Logger';

export default class ProxyServiceProvider extends ServiceProvider {
    register(): void {
        this.app.registerInstance(ProxyConfig, ProxyConfig.fromEnv(this.env));
    }

    boot(): void {
        if (!this.app.resolve(ProxyConfig).secret) {
            this.app
                .resolve(Logger)
                .warn(
                    {},
                    'PROXY_SECRET not set: inline video (TikTok/Threads/Instagram) disabled — media degrades to thumbnail or link',
                );
        }
    }
}
