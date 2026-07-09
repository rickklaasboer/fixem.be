import ServiceProvider from '@/providers/ServiceProvider';
import ApiConfig from '@/config/ApiConfig';

export default class ApiServiceProvider extends ServiceProvider {
    register(): void {
        this.app.registerInstance(ApiConfig, ApiConfig.fromEnv(this.env));
    }
}
