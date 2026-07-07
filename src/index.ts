import { buildApp } from "./app";
import { loadConfig } from "./lib/config";
import { createLogger } from "./lib/logger";
import { createRedisCache } from "./lib/cache";
import { createRedisRateLimitStore } from "./lib/rate-limit";
import { Resolver } from "./resolver";
import { AdapterRegistry } from "./adapters/registry";
import { createRedditAdapter } from "./adapters/reddit";
import { createBlueskyAdapter } from "./adapters/bluesky";
import { createDummyAdapter } from "./adapters/dummy";

const config = loadConfig();
const logger = createLogger();
const cache = createRedisCache(config.redisUrl);
const registry = new AdapterRegistry([
  createRedditAdapter(),
  createBlueskyAdapter(),
  createDummyAdapter(),
]);
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
