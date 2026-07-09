import type {DependencyContainer} from 'tsyringe';
import type {Env} from '@/config/env';

/**
 * Laravel-style service provider. `register()` binds tokens (and must NOT
 * resolve services another provider owns); `boot()` runs after every provider
 * has registered and may resolve / emit side-effects.
 */
export default abstract class ServiceProvider {
    constructor(
        protected readonly app: DependencyContainer,
        protected readonly env: Env,
    ) {}

    register(): void {}
    boot(): void {}
}
