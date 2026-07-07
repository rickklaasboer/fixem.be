import { buildApp } from "./app";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { createRedisCache } from "./lib/cache";
import { createRedisRateLimitStore } from "./lib/rate-limit";
import { Resolver } from "./resolver";
import { AdapterRegistry } from "./adapters/registry";
import { createRedditAdapter } from "./adapters/reddit";
import { createBlueskyAdapter } from "./adapters/bluesky";
import { createTwitterAdapter } from "./adapters/twitter";
import { createTwitchAdapter } from "./adapters/twitch";
import { createThreadsAdapter } from "./adapters/threads";
import { createTiktokAdapter } from "./adapters/tiktok";
import { createInstagramAdapter } from "./adapters/instagram";
import { createDummyAdapter } from "./adapters/dummy";

const config = loadConfig();
const logger = createLogger();
const cache = createRedisCache(config.redisUrl);
const adapters = [
  createRedditAdapter(
    fetch,
    config.redditClientId && config.redditClientSecret
      ? { clientId: config.redditClientId, clientSecret: config.redditClientSecret }
      : undefined,
  ),
  createBlueskyAdapter(),
  createTwitterAdapter(fetch, config.twitterSyndicationFeatures),
  // Anonymous adapters — always registered, no credentials gate. Inline video
  // (TikTok/Threads/Instagram) requires PROXY_SECRET (warned below); without it
  // media degrades to a thumbnail or link.
  createThreadsAdapter(fetch, config.threads),
  createTiktokAdapter(fetch, config.tiktok),
  createInstagramAdapter(fetch, config.instagram),
  createDummyAdapter(),
];
if (config.twitchClientId && config.twitchClientSecret) {
  adapters.splice(
    2,
    0,
    createTwitchAdapter(
      { clientId: config.twitchClientId, clientSecret: config.twitchClientSecret },
      fetch,
      { clientId: config.twitchGqlClientId, clipTokenHash: config.twitchGqlClipHash },
    ),
  );
} else {
  logger.warn({}, "twitch adapter disabled: TWITCH_CLIENT_ID/SECRET not set");
}
if (!config.proxySecret) {
  logger.warn(
    {},
    "PROXY_SECRET not set: inline video (TikTok/Threads/Instagram) disabled — media degrades to thumbnail or link",
  );
}
const registry = new AdapterRegistry(adapters);
const resolver = new Resolver({
  registry,
  cache,
  logger,
  ttlSeconds: config.cacheTtlSeconds,
  timeoutMs: config.resolveTimeoutMs,
});

const landingHtml = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

const app = buildApp({
  config,
  logger,
  cache,
  resolver,
  rateLimitStore: createRedisRateLimitStore(config.redisUrl),
  landingHtml,
});

logger.info({ port: config.port }, "fixem.be listening");

export default {
  port: config.port,
  fetch: app.fetch,
};
