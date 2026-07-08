import type {Hono} from 'hono';
import type {DependencyContainer} from 'tsyringe';
import {container} from '@/container';
import HealthController from '@/http/controllers/HealthController';
import OembedController from '@/http/controllers/OembedController';
import StatusController from '@/http/controllers/StatusController';
import ProxyController from '@/http/controllers/ProxyController';
import EmbedController from '@/http/controllers/EmbedController';
import ApiAuthMiddleware from '@/http/middleware/ApiAuthMiddleware';
import RateLimitMiddleware from '@/http/middleware/RateLimitMiddleware';

/**
 * Bind every route and middleware onto `server`, resolving controllers and
 * middleware from `di` — the global container in production, a per-test child
 * container under `createTestApp`. `/v/` intentionally carries no rate-limit
 * middleware (ProxyStreamer meters itself); `*` and `/oembed` do.
 */
export default function routes(
    server: Hono,
    di: DependencyContainer = container,
): void {
    const health = di.resolve(HealthController);
    const oembed = di.resolve(OembedController);
    const status = di.resolve(StatusController);
    const proxy = di.resolve(ProxyController);
    const embed = di.resolve(EmbedController);
    const apiAuth = di.resolve(ApiAuthMiddleware);
    const rateLimit = di.resolve(RateLimitMiddleware);

    server.get('/', (c) => health.index(c));
    server.get('/healthz', (c) => health.healthz(c));
    server.get('/oembed', rateLimit.handle, (c) => oembed.show(c));
    server.use('/api/*', apiAuth.handle);
    server.get('/api/status/adapter', (c) => status.adapter(c));
    server.get('/v/:token', (c) => proxy.stream(c));
    server.get('*', rateLimit.handle, (c) => embed.handle(c));
    server.onError((err, c) => embed.onError(err, c));
}
