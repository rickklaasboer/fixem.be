import type {InjectionToken} from 'tsyringe';
import ServiceProvider from '@/providers/ServiceProvider';
import Cache from '@/services/cache/Cache';
import RedisCache from '@/services/cache/RedisCache';
import RedisConfig from '@/config/RedisConfig';
import redisClient from '@/services/redisClient';

export default class CacheServiceProvider extends ServiceProvider {
    register(): void {
        const {url} = RedisConfig.fromEnv(this.env);
        // `Cache` is an abstract class used as the token; the cast satisfies
        // tsyringe's non-abstract InjectionToken type without changing identity.
        this.app.registerInstance(
            Cache as unknown as InjectionToken<Cache>,
            new RedisCache(redisClient(url)),
        );
    }
}
