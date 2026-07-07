import { TWITCH_GQL_DEFAULTS } from "../adapters/twitch";

export interface Config {
  port: number;
  redisUrl: string;
  cacheTtlSeconds: number;
  resolveTimeoutMs: number;
  rateLimitPerMin: number;
  publicBaseUrl: string;
  extraCrawlerUas: string[];
  twitchClientId?: string;
  twitchClientSecret?: string;
  twitchGqlClientId: string;
  twitchGqlClipHash: string;
  redditClientId?: string;
  redditClientSecret?: string;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// An operator typo (e.g. RATE_LIMIT_PER_MIN=0) must not brick the service:
// values below a sane floor fall back to the default.
function intMin(value: string | undefined, fallback: number, min: number): number {
  const n = int(value, fallback);
  return n < min ? fallback : n;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  return {
    port: intMin(env.PORT, 3000, 1),
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    cacheTtlSeconds: intMin(env.CACHE_TTL_SECONDS, 14400, 1),
    resolveTimeoutMs: intMin(env.RESOLVE_TIMEOUT_MS, 5000, 100),
    rateLimitPerMin: intMin(env.RATE_LIMIT_PER_MIN, 60, 1),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "https://fixem.be",
    extraCrawlerUas: (env.EXTRA_CRAWLER_UAS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    twitchClientId: env.TWITCH_CLIENT_ID,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET,
    twitchGqlClientId: env.TWITCH_GQL_CLIENT_ID ?? TWITCH_GQL_DEFAULTS.clientId,
    twitchGqlClipHash: env.TWITCH_GQL_CLIP_HASH ?? TWITCH_GQL_DEFAULTS.clipTokenHash,
    redditClientId: env.REDDIT_CLIENT_ID,
    redditClientSecret: env.REDDIT_CLIENT_SECRET,
  };
}
