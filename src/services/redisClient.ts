import {RedisClient} from 'bun';

/**
 * Build a Redis/Valkey client. Fails open: no offline queue + a short connect
 * timeout so a Redis outage degrades to cache-less operation, never blocking.
 */
export default function redisClient(url: string): RedisClient {
    return new RedisClient(url, {
        enableOfflineQueue: false,
        connectionTimeout: 2000,
    });
}
