import type {RedisClient} from 'bun';
import Cache from '@/services/cache/Cache';

// Redis-backed cache. Every operation is best-effort: a Redis outage must
// degrade to cache-less resolution, never break a request (spec §4).
// Exported for tests to exercise the fail-open path with a stubbed client.
export default class RedisCache extends Cache {
    constructor(private readonly client: RedisClient) {
        super();
    }

    async get(key: string): Promise<string | null> {
        try {
            const v = await this.client.send('GET', [key]);
            return typeof v === 'string' ? v : null;
        } catch {
            return null;
        }
    }

    async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
        try {
            await this.client.send('SET', [
                key,
                value,
                'EX',
                String(ttlSeconds),
            ]);
        } catch {
            // best-effort
        }
    }

    async ping(): Promise<boolean> {
        try {
            return (await this.client.send('PING', [])) === 'PONG';
        } catch {
            return false;
        }
    }
}
