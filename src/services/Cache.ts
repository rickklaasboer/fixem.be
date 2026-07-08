/**
 * Metadata cache contract. Abstract (not an interface) so it can be a tsyringe
 * injection token; RedisCache/MemoryCache are the impls.
 */
export default abstract class Cache {
    abstract get(key: string): Promise<string | null>;
    abstract setEx(
        key: string,
        ttlSeconds: number,
        value: string,
    ): Promise<void>;
    abstract ping(): Promise<boolean>;
}
