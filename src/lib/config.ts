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
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  return {
    port: int(env.PORT, 3000),
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    cacheTtlSeconds: int(env.CACHE_TTL_SECONDS, 14400),
    resolveTimeoutMs: int(env.RESOLVE_TIMEOUT_MS, 5000),
    rateLimitPerMin: int(env.RATE_LIMIT_PER_MIN, 60),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "https://fixem.be",
    extraCrawlerUas: (env.EXTRA_CRAWLER_UAS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    twitchClientId: env.TWITCH_CLIENT_ID,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET,
  };
}
