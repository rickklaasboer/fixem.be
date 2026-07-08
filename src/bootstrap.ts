import {Hono} from 'hono';
import {RedisClient} from 'bun';
import type {InjectionToken} from 'tsyringe';
import {app, container} from '@/container';
import routes from '@/http/routes';
import Config, {loadConfig} from '@/config/Config';
import Logger from '@/services/Logger';
import HttpClient from '@/services/HttpClient';
import Cache from '@/services/cache/Cache';
import RedisCache from '@/services/cache/RedisCache';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';
import RedisRateLimitStore from '@/services/rate-limit/RedisRateLimitStore';
import Clock from '@/services/Clock';
import AdapterRegistry from '@/domain/AdapterRegistry';
import Resolver from '@/domain/Resolver';
import RedditAdapter from '@/adapters/RedditAdapter';
import BlueskyAdapter from '@/adapters/BlueskyAdapter';
import TwitterAdapter from '@/adapters/TwitterAdapter';
import TwitchAdapter from '@/adapters/TwitchAdapter';
import ThreadsAdapter from '@/adapters/ThreadsAdapter';
import TiktokAdapter from '@/adapters/TiktokAdapter';
import InstagramAdapter from '@/adapters/InstagramAdapter';
import DummyAdapter from '@/adapters/DummyAdapter';
import type PlatformAdapter from '@/domain/PlatformAdapter';

/**
 * Compose the application: register the leaf instances the container can't
 * build itself (config, sinks, Redis-backed stores, the ordered adapter
 * registry), then bind the routes onto a fresh Hono app. Everything else
 * (`@injectable`/`@singleton`) resolves on demand through the container.
 */
// `Cache`/`RateLimitStore` are abstract classes used as injection tokens; the
// cast satisfies tsyringe's non-abstract `InjectionToken` type without changing
// the runtime token identity that constructor injection matches against.
const cacheToken = Cache as unknown as InjectionToken<Cache>;
const rateLimitStoreToken =
    RateLimitStore as unknown as InjectionToken<RateLimitStore>;

export default function bootstrap(): Hono {
    // Leaf values the container can't construct on its own.
    container.registerInstance(Config, loadConfig());
    const config = app(Config);
    container.registerInstance(Logger, new Logger());
    container.registerInstance(HttpClient, new HttpClient());
    container.registerInstance(
        cacheToken,
        new RedisCache(
            new RedisClient(config.redisUrl, {
                enableOfflineQueue: false,
                connectionTimeout: 2000,
            }),
        ),
    );
    container.registerInstance(
        rateLimitStoreToken,
        new RedisRateLimitStore(
            new RedisClient(config.redisUrl, {
                enableOfflineQueue: false,
                connectionTimeout: 2000,
            }),
        ),
    );

    // Ordered adapter registry — registry.find() returns the first match, so
    // this order is behavioural. Mirrors the pre-refactor index.ts exactly,
    // including splicing Twitch in at index 2 only when credentials are set.
    const adapters: PlatformAdapter[] = [
        app(RedditAdapter),
        app(BlueskyAdapter),
        app(TwitterAdapter),
        app(ThreadsAdapter),
        app(TiktokAdapter),
        app(InstagramAdapter),
        app(DummyAdapter),
    ];
    if (config.twitchClientId && config.twitchClientSecret) {
        adapters.splice(2, 0, app(TwitchAdapter));
    } else {
        app(Logger).warn(
            {},
            'twitch adapter disabled: TWITCH_CLIENT_ID/SECRET not set',
        );
    }
    if (!config.proxySecret) {
        app(Logger).warn(
            {},
            'PROXY_SECRET not set: inline video (TikTok/Threads/Instagram) disabled — media degrades to thumbnail or link',
        );
    }
    container.registerInstance(AdapterRegistry, new AdapterRegistry(adapters));

    // Resolver's two trailing constructor params (breakerThreshold,
    // breakerCooldownMs) carry defaults, so tsyringe would try to inject them
    // as `Number` and throw. Build it from its resolved deps (keeping those
    // defaults) and register the instance so controllers can inject it.
    container.registerInstance(
        Resolver,
        new Resolver(
            app(AdapterRegistry),
            app(cacheToken),
            app(Logger),
            app(Clock),
            app(Config),
        ),
    );

    const server = new Hono();
    routes(server);
    return server;
}
