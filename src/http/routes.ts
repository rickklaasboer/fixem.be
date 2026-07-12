import type {Hono} from 'hono';
import type {DependencyContainer} from 'tsyringe';
import {container} from '@/container';
import HealthController from '@/http/controllers/HealthController';
import OembedController from '@/http/controllers/OembedController';
import ApiV1Controller from '@/http/controllers/ApiV1Controller';
import OpenApiController from '@/http/controllers/OpenApiController';
import ProxyController from '@/http/controllers/ProxyController';
import EmbedController from '@/http/controllers/EmbedController';
import StatsController from '@/http/controllers/StatsController';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import ApiRateLimitMiddleware from '@/http/middleware/ApiRateLimitMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';
import StatsAuthMiddleware from '@/http/middleware/StatsAuthMiddleware';

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
    const openapi = di.resolve(OpenApiController);
    const proxy = di.resolve(ProxyController);
    const embed = di.resolve(EmbedController);
    const stats = di.resolve(StatsController);
    const apiAuth = di.resolve(ApiAuthMiddleware);
    const apiRateLimit = di.resolve(ApiRateLimitMiddleware);
    const rateLimit = di.resolve(RateLimitMiddleware);
    const statsAuth = di.resolve(StatsAuthMiddleware);

    server.get('/', (c) => health.index(c));
    server.get('/healthz', (c) => health.healthz(c));
    server.get('/openapi.yaml', (c) => openapi.spec(c));
    server.get('/oembed', rateLimit.handle, (c) => oembed.show(c));

    // Public API v1: customer auth + per-key rate limit, scoped to the exact
    // customer paths so the admin /api/v1/stats/* subtree is NOT caught by the
    // customer gate (a broad '/api/v1/*' use() would 401 the admin token).
    for (const p of [
        '/api/v1/resolve',
        '/api/v1/canonical',
        '/api/v1/platforms',
        '/api/v1/health',
    ]) {
        server.use(p, apiAuth.handle);
        server.use(p, apiRateLimit.handle);
    }
    server.get('/api/v1/resolve', (c) => api.resolve(c));
    server.post('/api/v1/resolve', (c) => api.resolveBatch(c));
    server.get('/api/v1/canonical', (c) => api.canonical(c));
    server.get('/api/v1/platforms', (c) => api.platforms(c));
    server.get('/api/v1/health', (c) => api.health(c));

    // Admin usage stats: separate token (ADMIN_API_KEYS), closed 404 when unset.
    server.use('/api/v1/stats/*', statsAuth.handle);
    server.get('/api/v1/stats/usage', (c) => stats.usage(c));
    server.get('/api/v1/stats/keys', (c) => stats.keys(c));
    server.get('/api/v1/stats/bandwidth', (c) => stats.bandwidth(c));

    server.get('/v/:token', (c) => proxy.stream(c));
    server.get('*', rateLimit.handle, (c) => embed.handle(c));
    server.onError((err, c) => embed.onError(err, c));
}
