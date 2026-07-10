import type {InjectionToken} from 'tsyringe';
import ServiceProvider from '@/providers/ServiceProvider';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';
import RedisRateLimitStore from '@/services/rate-limit/RedisRateLimitStore';
import RateLimitConfig from '@/config/RateLimitConfig';
import RedisConfig from '@/config/RedisConfig';
import redisClient from '@/services/redisClient';

export default class RateLimitServiceProvider extends ServiceProvider {
    register(): void {
        const {url} = RedisConfig.fromEnv(this.env);
        this.app.registerInstance(
            RateLimitStore as unknown as InjectionToken<RateLimitStore>,
            new RedisRateLimitStore(redisClient(url)),
        );
        this.app.registerInstance(
            RateLimitConfig,
            RateLimitConfig.fromEnv(this.env),
        );
    }
}
