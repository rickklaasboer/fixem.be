/**
 * Rate-limit store contract. Abstract (not an interface) so it can be a
 * tsyringe injection token; RedisRateLimitStore/MemoryRateLimitStore are the
 * impls.
 */
export default abstract class RateLimitStore {
    abstract hit(key: string, windowMs: number, now: number): Promise<number>;

    static clientIp(headers: Headers): string {
        const cf = headers.get('CF-Connecting-IP')?.trim();
        if (cf) return cf;
        const xff = headers.get('X-Forwarded-For');
        if (xff) {
            const first = xff.split(',')[0]?.trim();
            if (first) return first;
        }
        return 'unknown';
    }
}
