import { RedisClient } from "bun";

export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, number[]>();

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const cutoff = now - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    list.push(now);
    this.hits.set(key, list);
    return list.length;
  }
}

// Sliding window over a Redis sorted set. Fail-open: if Redis is down,
// rate limiting is disabled rather than blocking traffic.
class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisClient) {}

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const k = `rl:${key}`;
    try {
      await this.client.send("ZREMRANGEBYSCORE", [k, "0", String(now - windowMs)]);
      await this.client.send("ZADD", [k, String(now), `${now}-${Math.random()}`]);
      await this.client.send("PEXPIRE", [k, String(windowMs)]);
      const n = await this.client.send("ZCARD", [k]);
      return typeof n === "number" ? n : 0;
    } catch {
      return 0;
    }
  }
}

export function createRedisRateLimitStore(url: string): RateLimitStore {
  return new RedisRateLimitStore(new RedisClient(url));
}

export function clientIp(headers: Headers): string {
  const cf = headers.get("CF-Connecting-IP");
  if (cf) return cf.trim();
  const xff = headers.get("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
