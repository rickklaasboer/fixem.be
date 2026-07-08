import Cache from '@/services/Cache';

// Test/dev backend: evicts lazily on read only and has no size bound, so it
// is not suitable for production traffic — production wiring uses
// RedisCache (bootstrap), and Redis owns expiry there.
export default class MemoryCache extends Cache {
    private store = new Map<string, {value: string; expiresAt: number}>();

    constructor(private readonly now: () => number = Date.now) {
        super();
    }

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
