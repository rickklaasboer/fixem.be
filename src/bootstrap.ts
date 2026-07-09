import {Hono} from 'hono';
import type {DependencyContainer} from 'tsyringe';
import {container} from '@/container';
import routes from '@/http/routes';
import Config, {loadConfig} from '@/config/Config';
import CoreServiceProvider from '@/providers/CoreServiceProvider';
import CacheServiceProvider from '@/providers/CacheServiceProvider';
import RateLimitServiceProvider from '@/providers/RateLimitServiceProvider';
import ApiServiceProvider from '@/providers/ApiServiceProvider';
import ProxyServiceProvider from '@/providers/ProxyServiceProvider';
import AdapterServiceProvider from '@/providers/AdapterServiceProvider';
import type ServiceProvider from '@/providers/ServiceProvider';
import type {Env} from '@/config/env';

// Order is behavioural: Core (Logger/HttpClient/app config) must register before
// AdapterServiceProvider eagerly resolves adapters that inject them.
const PROVIDERS = [
    CoreServiceProvider,
    CacheServiceProvider,
    RateLimitServiceProvider,
    ApiServiceProvider,
    ProxyServiceProvider,
    AdapterServiceProvider,
];

/**
 * Compose the application: instantiate the ordered provider list, run every
 * `register()` (bind phase) then every `boot()` (side-effect phase), and bind
 * routes onto a fresh Hono app.
 */
export default function bootstrap(): Hono {
    const env = process.env as Env;

    // TEMPORARY (removed in the config-migration cleanup): consumers still inject
    // the flat `Config`; keep it registered until every consumer reads a slice.
    container.registerInstance(Config, loadConfig(env));

    const providers: ServiceProvider[] = PROVIDERS.map(
        (P) => new P(container as DependencyContainer, env),
    );
    for (const p of providers) p.register();
    for (const p of providers) p.boot();

    const server = new Hono();
    routes(server);
    return server;
}
