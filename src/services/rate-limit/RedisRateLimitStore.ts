import type {RedisClient} from 'bun';
import RateLimitStore from '@/services/rate-limit/RateLimitStore';

// Sliding window over a Redis sorted set. Fail-open: if Redis is down,
// rate limiting is disabled rather than blocking traffic.
// Exported for tests to exercise the fail-open path with a stubbed client.
export default class RedisRateLimitStore extends RateLimitStore {
    constructor(private readonly client: RedisClient) {
        super();
    }

    async hit(key: string, windowMs: number, now: number): Promise<number> {
        const k = `rl:${key}`;
        try {
            await this.client.send('ZREMRANGEBYSCORE', [
                k,
                '0',
                String(now - windowMs),
            ]);
            await this.client.send('ZADD', [
                k,
                String(now),
                `${now}-${Math.random()}`,
            ]);
            await this.client.send('PEXPIRE', [k, String(windowMs)]);
            const n = await this.client.send('ZCARD', [k]);
            return typeof n === 'number' ? n : 0;
        } catch {
            return 0;
        }
    }
}
