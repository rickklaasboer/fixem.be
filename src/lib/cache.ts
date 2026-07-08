import {RedisClient} from 'bun';

export interface MetadataCache {
    get(key: string): Promise<string | null>;
    setEx(key: string, ttlSeconds: number, value: string): Promise<void>;
    ping(): Promise<boolean>;
}

// Test/dev backend: evicts lazily on read only and has no size bound, so it
// is not suitable for production traffic — production wiring uses
// createRedisCache (src/index.ts), and Redis owns expiry there.
export class MemoryCache implements MetadataCache {
    private store = new Map<string, {value: string; expiresAt: number}>();

    constructor(private readonly now: () => number = Date.now) {}

    async get(key: string): Promise<string | null> {
        const e = this.store.get(key);
        if (!e) return null;
        if (this.now() > e.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return e.value;
    }

    async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
        this.store.set(key, {value, expiresAt: this.now() + ttlSeconds * 1000});
    }

    async ping(): Promise<boolean> {
        return true;
    }
}

// Redis-backed cache. Every operation is best-effort: a Redis outage must
// degrade to cache-less resolution, never break a request (spec §4).
// Exported for tests to exercise the fail-open path with a stubbed client.
export class RedisCache implements MetadataCache {
    constructor(private readonly client: RedisClient) {}

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

// enableOfflineQueue: false makes commands reject immediately while Redis is
// unreachable (instead of queueing through reconnect backoff), so the
// best-effort catch blocks fail open without stalling requests.
export function createRedisCache(url: string): MetadataCache {
    return new RedisCache(
        new RedisClient(url, {
            enableOfflineQueue: false,
            connectionTimeout: 2000,
        }),
    );
}
