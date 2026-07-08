import {singleton} from 'tsyringe';
import AdapterRegistry from '@/domain/AdapterRegistry';
import Cache from '@/services/cache/Cache';
import Logger from '@/services/Logger';
import Clock from '@/services/Clock';
import Config from '@/config/Config';
import type EmbedMetadata from '@/domain/EmbedMetadata';
import type ResolveOutcome from '@/domain/ResolveOutcome';

function withTimeout<T>(
    p: Promise<T>,
    ms: number,
    onTimeout?: () => void,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => {
            onTimeout?.();
            reject(new Error('timeout'));
        }, ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            },
        );
    });
}

@singleton()
export default class Resolver {
    private readonly inflight = new Map<string, Promise<ResolveOutcome>>();
    private readonly failures = new Map<
        string,
        {count: number; openUntil: number}
    >();

    constructor(
        private registry: AdapterRegistry,
        private cache: Cache,
        private logger: Logger,
        private clock: Clock,
        private config: Config,
        private readonly breakerThreshold: number = 5,
        private readonly breakerCooldownMs: number = 60_000,
    ) {}

    canonicalFor(url: URL): {canonicalUrl: string; platform: string} | null {
        try {
            const adapter = this.registry.find(url);
            if (!adapter) return null;
            return {
                canonicalUrl: adapter.canonicalize(url),
                platform: adapter.name,
            };
        } catch {
            // a throwing match()/canonicalize() degrades to "no adapter"
            return null;
        }
    }

    // Top-level guard: the "failures degrade, never throw" invariant must hold
    // even if an adapter's match()/canonicalize() or the cache itself throws.
    async resolve(url: URL): Promise<ResolveOutcome> {
        try {
            return await this.resolveInner(url);
        } catch (err) {
            this.logger.error(
                {err: String(err), url: url.href},
                'resolver internal error, degrading',
            );
            return {
                status: 'degraded',
                canonicalUrl: url.href,
                platform: 'unknown',
                reason: 'internal',
            };
        }
    }

    private async resolveInner(url: URL): Promise<ResolveOutcome> {
        const adapter = this.registry.find(url);
        if (!adapter) return {status: 'no-adapter'};
        const canonicalUrl = adapter.canonicalize(url);
        const platform = adapter.name;

        // Cache first, breaker second: a fresh cached embed needs no adapter
        // call, so an open breaker must not degrade it.
        const key = `meta:${canonicalUrl}`;
        const cached = await this.cache.get(key);
        if (cached !== null) {
            try {
                const meta = JSON.parse(cached) as EmbedMetadata;
                return {
                    status: 'ok',
                    meta,
                    canonicalUrl,
                    platform,
                    cacheHit: true,
                };
            } catch {
                // corrupt cache entry — fall through to a fresh resolve
            }
        }

        const breaker = this.failures.get(platform);
        if (breaker && breaker.openUntil > this.clock.now()) {
            return {
                status: 'degraded',
                canonicalUrl,
                platform,
                reason: 'breaker-open',
            };
        }

        const existing = this.inflight.get(key);
        if (existing) return existing;

        const p = this.doResolve(url, canonicalUrl, platform, key).finally(
            () => {
                this.inflight.delete(key);
            },
        );
        this.inflight.set(key, p);
        return p;
    }

    private async doResolve(
        url: URL,
        canonicalUrl: string,
        platform: string,
        key: string,
    ): Promise<ResolveOutcome> {
        const adapter = this.registry.find(url)!;
        const started = this.clock.now();
        // Abort the adapter's in-flight fetches when the timeout fires, so a hung
        // upstream releases its socket instead of running on orphaned past our reply.
        const abort = new AbortController();
        try {
            const meta = await withTimeout(
                adapter.resolve(url, abort.signal),
                this.config.resolveTimeoutMs,
                () => abort.abort(),
            );
            this.failures.delete(platform);
            const ttl = Math.min(
                meta.ttlSeconds ?? this.config.cacheTtlSeconds,
                this.config.cacheTtlSeconds,
            );
            await this.cache.setEx(key, ttl, JSON.stringify(meta));
            this.logger.info(
                {
                    platform,
                    cache: 'miss',
                    latencyMs: this.clock.now() - started,
                },
                'resolved',
            );
            return {
                status: 'ok',
                meta,
                canonicalUrl,
                platform,
                cacheHit: false,
            };
        } catch (err) {
            const reason =
                err instanceof Error && err.message === 'timeout'
                    ? 'timeout'
                    : 'error';
            const f = this.failures.get(platform) ?? {count: 0, openUntil: 0};
            f.count += 1;
            if (f.count >= this.breakerThreshold) {
                f.openUntil = this.clock.now() + this.breakerCooldownMs;
                f.count = 0;
            }
            this.failures.set(platform, f);
            this.logger.warn(
                {
                    platform,
                    reason,
                    latencyMs: this.clock.now() - started,
                    err: String(err),
                },
                'resolve failed',
            );
            return {status: 'degraded', canonicalUrl, platform, reason};
        }
    }
}
