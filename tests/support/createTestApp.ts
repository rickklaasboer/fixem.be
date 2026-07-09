import 'reflect-metadata';
import {Hono} from 'hono';
import type {InjectionToken} from 'tsyringe';
import {container} from '@/container';
import routes from '@/http/routes';
import Config, {loadConfig} from '@/config/Config';
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
    /** Partial config merged over a defaults-only base (`loadConfig({})`). */
    config?: Partial<Config>;
    /** Adapters for the registry (default: the example.com DummyAdapter). */
    adapters?: PlatformAdapter[];
    /** Replace the resolver wholesale (e.g. a throwing/degrading fake). */
    resolver?: Resolver;
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
 * container so `@singleton` state (breaker maps, rate-limit counters, captured
 * config) never bleeds between tests. Leaves are registered as instances;
 * config-capturing/stateful singletons are re-registered so the child builds
 * fresh ones. Controllers stay `@injectable` and resolve on demand.
 */
export default function createTestApp(overrides: TestAppOverrides = {}): Hono {
    const c = container.createChildContainer();

    const config: Config = Object.assign(
        loadConfig({}),
        overrides.config ?? {},
    );
    c.registerInstance(Config, config);
    // TRANSITIONAL bridge: derive slices from the merged legacy `config` so both
    // Config-based and slice-based consumers see the same test overrides. Removed
    // in the cleanup task once TestAppOverrides becomes per-slice.
    c.registerInstance(
        AppConfig,
        Object.assign(new AppConfig(), {
            port: config.port,
            publicBaseUrl: config.publicBaseUrl,
            extraCrawlerUas: config.extraCrawlerUas,
        }),
    );
    c.registerInstance(
        ResolverConfig,
        Object.assign(new ResolverConfig(), {
            resolveTimeoutMs: config.resolveTimeoutMs,
            cacheTtlSeconds: config.cacheTtlSeconds,
        }),
    );
    c.registerInstance(
        RateLimitConfig,
        Object.assign(new RateLimitConfig(), {perMin: config.rateLimitPerMin}),
    );
    c.registerInstance(
        ApiConfig,
        Object.assign(new ApiConfig(), {
            keys: config.apiKeys,
            rateLimitPerMin: config.apiRateLimitPerMin,
            batchMaxUrls: config.batchMaxUrls,
        }),
    );
    c.registerInstance(
        ProxyConfig,
        Object.assign(new ProxyConfig(), {
            secret: config.proxySecret,
            hostAllowlist: config.proxyHostAllowlist,
            maxConcurrent: config.proxyMaxConcurrent,
            maxBytes: config.proxyMaxBytes,
            timeoutMs: config.proxyTimeoutMs,
        }),
    );
    c.registerInstance(
        RedditConfig,
        Object.assign(new RedditConfig(), {
            clientId: config.redditClientId,
            clientSecret: config.redditClientSecret,
            proxyUrl: config.redditProxyUrl,
            httpProxy: config.redditHttpProxy,
        }),
    );
    c.registerInstance(
        TwitchConfig,
        Object.assign(new TwitchConfig(), {
            clientId: config.twitchClientId,
            clientSecret: config.twitchClientSecret,
            gqlClientId: config.twitchGqlClientId,
            gqlClipHash: config.twitchGqlClipHash,
        }),
    );
    c.registerInstance(
        TwitterConfig,
        Object.assign(new TwitterConfig(), {
            syndicationFeatures: config.twitterSyndicationFeatures,
        }),
    );
    c.registerInstance(
        ThreadsConfig,
        Object.assign(new ThreadsConfig(), config.threads),
    );
    c.registerInstance(
        TiktokConfig,
        Object.assign(new TiktokConfig(), config.tiktok),
    );
    c.registerInstance(
        InstagramConfig,
        Object.assign(new InstagramConfig(), config.instagram),
    );
    c.registerInstance(Logger, new Logger({write: () => {}}));
    c.registerInstance(HttpClient, overrides.httpClient ?? new HttpClient());
    c.registerInstance(cacheToken, overrides.cache ?? new MemoryCache());
    c.registerInstance(
        rateLimitStoreToken,
        overrides.rateLimitStore ?? new MemoryRateLimitStore(),
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
    // Resolver also accepts a caller-supplied fake (throwing/degraded tests).
    if (overrides.resolver) {
        c.registerInstance(Resolver, overrides.resolver);
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
