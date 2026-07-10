import 'reflect-metadata';
import {Hono} from 'hono';
import type {InjectionToken} from 'tsyringe';
import {container} from '@/container';
import routes from '@/http/routes';
import Logger from '@/services/Logger';
import HttpClient from '@/services/HttpClient';
import Cache from '@/services/cache/Cache';
import MemoryCache from '@/services/cache/MemoryCache';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';
import MemoryRateLimitStore from '@/services/rate-limit/MemoryRateLimitStore';
import Clock from '@/services/Clock';
import LandingPage from '@/services/LandingPage';
import VideoProxy from '@/services/proxy/VideoProxy';
import ProxyStreamer from '@/services/proxy/ProxyStreamer';
import AdapterRegistry from '@/domain/AdapterRegistry';
import Resolver from '@/domain/Resolver';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import ApiRateLimitMiddleware from '@/http/middleware/ApiRateLimitMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';
import DummyAdapter from '@/adapters/DummyAdapter';
import AppConfig from '@/config/AppConfig';
import ResolverConfig from '@/config/ResolverConfig';
import RateLimitConfig from '@/config/RateLimitConfig';
import ApiConfig from '@/config/ApiConfig';
import ProxyConfig from '@/config/ProxyConfig';
import RedditConfig from '@/config/RedditConfig';
import TwitchConfig from '@/config/TwitchConfig';
import TwitterConfig from '@/config/TwitterConfig';
import ThreadsConfig from '@/config/ThreadsConfig';
import TiktokConfig from '@/config/TiktokConfig';
import InstagramConfig from '@/config/InstagramConfig';
import type PlatformAdapter from '@/domain/PlatformAdapter';

// `Cache`/`RateLimitStore` are abstract classes used as injection tokens; the
// cast satisfies tsyringe's non-abstract `InjectionToken` type without changing
// the runtime token identity that constructor injection matches against.
const cacheToken = Cache as unknown as InjectionToken<Cache>;
const rateLimitStoreToken =
    RateLimitStore as unknown as InjectionToken<RateLimitStore>;

export interface TestAppOverrides {
    app?: Partial<AppConfig>;
    resolver?: Partial<ResolverConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    api?: Partial<ApiConfig>;
    proxy?: Partial<ProxyConfig>;
    reddit?: Partial<RedditConfig>;
    twitch?: Partial<TwitchConfig>;
    twitter?: Partial<TwitterConfig>;
    threads?: Partial<ThreadsConfig>;
    tiktok?: Partial<TiktokConfig>;
    instagram?: Partial<InstagramConfig>;
    /** Adapters for the registry (default: the example.com DummyAdapter). */
    adapters?: PlatformAdapter[];
    /** Replace the resolver wholesale (e.g. a throwing/degrading fake). */
    resolverInstance?: Resolver;
    cache?: Cache;
    rateLimitStore?: RateLimitStore;
    httpClient?: HttpClient;
    /** Landing HTML served by `GET /`. */
    landingHtml?: string;
    /** Controllable wall clock. */
    now?: () => number;
}

/**
 * Build a fully-routed Hono app for integration tests, wired from a child
 * container so `@singleton` state (breaker maps, rate-limit counters) never
 * bleeds between tests. Config slices are defaults-from-empty-env merged with
 * per-slice overrides; controllers stay `@injectable` and resolve on demand.
 */
export default function createTestApp(overrides: TestAppOverrides = {}): Hono {
    const c = container.createChildContainer();

    const slice = <T extends object>(base: T, over?: Partial<T>): T =>
        Object.assign(base, over ?? {});

    c.registerInstance(Logger, new Logger({write: () => {}}));
    c.registerInstance(HttpClient, overrides.httpClient ?? new HttpClient());
    c.registerInstance(cacheToken, overrides.cache ?? new MemoryCache());
    c.registerInstance(
        rateLimitStoreToken,
        overrides.rateLimitStore ?? new MemoryRateLimitStore(),
    );

    c.registerInstance(AppConfig, slice(AppConfig.fromEnv({}), overrides.app));
    c.registerInstance(
        ResolverConfig,
        slice(ResolverConfig.fromEnv({}), overrides.resolver),
    );
    c.registerInstance(
        RateLimitConfig,
        slice(RateLimitConfig.fromEnv({}), overrides.rateLimit),
    );
    c.registerInstance(ApiConfig, slice(ApiConfig.fromEnv({}), overrides.api));
    c.registerInstance(
        ProxyConfig,
        slice(ProxyConfig.fromEnv({}), overrides.proxy),
    );
    c.registerInstance(
        RedditConfig,
        slice(RedditConfig.fromEnv({}), overrides.reddit),
    );
    c.registerInstance(
        TwitchConfig,
        slice(TwitchConfig.fromEnv({}), overrides.twitch),
    );
    c.registerInstance(
        TwitterConfig,
        slice(TwitterConfig.fromEnv({}), overrides.twitter),
    );
    c.registerInstance(
        ThreadsConfig,
        slice(ThreadsConfig.fromEnv({}), overrides.threads),
    );
    c.registerInstance(
        TiktokConfig,
        slice(TiktokConfig.fromEnv({}), overrides.tiktok),
    );
    c.registerInstance(
        InstagramConfig,
        slice(InstagramConfig.fromEnv({}), overrides.instagram),
    );

    const clock = new Clock();
    if (overrides.now) clock.now = overrides.now;
    c.registerInstance(Clock, clock);

    const landingHtml =
        overrides.landingHtml ?? '<html>fixem.be landing</html>';
    const landing = new LandingPage();
    landing.html = () => landingHtml;
    c.registerInstance(LandingPage, landing);

    const adapters = overrides.adapters ?? [c.resolve(DummyAdapter)];
    c.registerInstance(AdapterRegistry, new AdapterRegistry(adapters));

    // These singletons capture per-test config or hold mutable state. Without
    // re-registration the child would reuse a globally-cached instance built
    // for an earlier test, so re-register them to force fresh construction.
    if (overrides.resolverInstance) {
        c.registerInstance(Resolver, overrides.resolverInstance);
    } else {
        c.registerSingleton(Resolver);
    }
    c.registerSingleton(VideoProxy);
    c.registerSingleton(ProxyStreamer);
    c.registerSingleton(ApiAuthMiddleware);
    c.registerSingleton(ApiRateLimitMiddleware);
    c.registerSingleton(RateLimitMiddleware);

    const server = new Hono();
    routes(server, c);
    return server;
}
