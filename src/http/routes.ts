import type {Hono} from 'hono';
import type {DependencyContainer} from 'tsyringe';
import {container} from '@/container';
import HealthController from '@/http/controllers/HealthController';
import OembedController from '@/http/controllers/OembedController';
import ApiV1Controller from '@/http/controllers/ApiV1Controller';
import ProxyController from '@/http/controllers/ProxyController';
import EmbedController from '@/http/controllers/EmbedController';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import ApiRateLimitMiddleware from '@/http/middleware/ApiRateLimitMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';

/**
 * Bind every route and middleware onto `server`, resolving controllers and
 * middleware from `di` — the global container in production, a per-test child
 * container under `createTestApp`. `/v/` intentionally carries no rate-limit
 * middleware (ProxyStreamer meters itself); `*` and `/oembed` use the IP-based
 * limiter; `/api/v1/*` uses bearer auth + the key-based limiter.
 */
export default function routes(
    server: Hono,
    di: DependencyContainer = container,
): void {
    const health = di.resolve(HealthController);
    const oembed = di.resolve(OembedController);
    const api = di.resolve(ApiV1Controller);
    const proxy = di.resolve(ProxyController);
    const embed = di.resolve(EmbedController);
    const apiAuth = di.resolve(ApiAuthMiddleware);
    const apiRateLimit = di.resolve(ApiRateLimitMiddleware);
    const rateLimit = di.resolve(RateLimitMiddleware);

    server.get('/', (c) => health.index(c));
    server.get('/healthz', (c) => health.healthz(c));
    server.get('/oembed', rateLimit.handle, (c) => oembed.show(c));

    // Public API v1: bearer-gated, then key-bucketed rate limit.
    server.use('/api/v1/*', apiAuth.handle);
    server.use('/api/v1/*', apiRateLimit.handle);
    server.get('/api/v1/resolve', (c) => api.resolve(c));
    server.post('/api/v1/resolve', (c) => api.resolveBatch(c));
    server.get('/api/v1/canonical', (c) => api.canonical(c));
    server.get('/api/v1/platforms', (c) => api.platforms(c));
    server.get('/api/v1/health', (c) => api.health(c));

    server.get('/v/:token', (c) => proxy.stream(c));
    server.get('*', rateLimit.handle, (c) => embed.handle(c));
    server.onError((err, c) => embed.onError(err, c));
}
