import ServiceProvider from '@/providers/ServiceProvider';
import Logger from '@/services/Logger';
import AdapterRegistry from '@/domain/AdapterRegistry';
import RedditConfig from '@/config/RedditConfig';
import TwitchConfig from '@/config/TwitchConfig';
import TwitterConfig from '@/config/TwitterConfig';
import ThreadsConfig from '@/config/ThreadsConfig';
import TiktokConfig from '@/config/TiktokConfig';
import InstagramConfig from '@/config/InstagramConfig';
import RedditAdapter from '@/adapters/RedditAdapter';
import BlueskyAdapter from '@/adapters/BlueskyAdapter';
import TwitterAdapter from '@/adapters/TwitterAdapter';
import TwitchAdapter from '@/adapters/TwitchAdapter';
import ThreadsAdapter from '@/adapters/ThreadsAdapter';
import TiktokAdapter from '@/adapters/TiktokAdapter';
import InstagramAdapter from '@/adapters/InstagramAdapter';
import DummyAdapter from '@/adapters/DummyAdapter';
import type PlatformAdapter from '@/domain/PlatformAdapter';

export default class AdapterServiceProvider extends ServiceProvider {
    register(): void {
        // Bind adapter config slices first so adapters resolve.
        this.app.registerInstance(RedditConfig, RedditConfig.fromEnv(this.env));
        this.app.registerInstance(TwitchConfig, TwitchConfig.fromEnv(this.env));
        this.app.registerInstance(
            TwitterConfig,
            TwitterConfig.fromEnv(this.env),
        );
        this.app.registerInstance(
            ThreadsConfig,
            ThreadsConfig.fromEnv(this.env),
        );
        this.app.registerInstance(TiktokConfig, TiktokConfig.fromEnv(this.env));
        this.app.registerInstance(
            InstagramConfig,
            InstagramConfig.fromEnv(this.env),
        );

        // Ordered registry — this order is behavioural (first match wins).
        // Twitch splices in at index 2 only when credentials are set, mirroring
        // the pre-refactor bootstrap exactly.
        const twitch = this.app.resolve(TwitchConfig);
        const adapters: PlatformAdapter[] = [
            this.app.resolve(RedditAdapter),
            this.app.resolve(BlueskyAdapter),
            ...(twitch.enabled ? [this.app.resolve(TwitchAdapter)] : []),
            this.app.resolve(TwitterAdapter),
            this.app.resolve(ThreadsAdapter),
            this.app.resolve(TiktokAdapter),
            this.app.resolve(InstagramAdapter),
            this.app.resolve(DummyAdapter),
        ];
        this.app.registerInstance(
            AdapterRegistry,
            new AdapterRegistry(adapters),
        );
    }

    boot(): void {
        if (!this.app.resolve(TwitchConfig).enabled) {
            this.app
                .resolve(Logger)
                .warn(
                    {},
                    'twitch adapter disabled: TWITCH_CLIENT_ID/SECRET not set',
                );
        }
    }
}
