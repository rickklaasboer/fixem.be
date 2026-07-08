import RateLimitStore from '@/services/RateLimitStore';

export default class MemoryRateLimitStore extends RateLimitStore {
    private hits = new Map<string, number[]>();

    async hit(key: string, windowMs: number, now: number): Promise<number> {
        const cutoff = now - windowMs;
        const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
        list.push(now);
        this.hits.set(key, list);
        return list.length;
    }
}
