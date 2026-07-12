import {singleton} from 'tsyringe';
import MetricsStore from '@/services/metrics/MetricsStore';
import Clock from '@/services/Clock';
import Logger from '@/services/Logger';
import type {
    UsageRow,
    ApiKeyRow,
    ProxyBytesRow,
} from '@/services/metrics/MetricsStore';
import type ResolveOutcome from '@/domain/ResolveOutcome';

const SEP = '\x1f'; // unit separator — cannot appear in platform/key values

export interface ResolveRecord {
    platform: string;
    outcome: string;
    cache: string;
    uaClass: string;
}

/**
 * In-memory accumulator for aggregate usage. `record*` calls are synchronous
 * map bumps that never throw or touch I/O. `flush()` (driven by an interval +
 * on shutdown in MetricsServiceProvider) snapshots and swaps the buffers, then
 * writes the snapshot in a single transaction; on failure the snapshot is
 * merged back for the next tick, so a transient store error loses nothing.
 */
@singleton()
export default class UsageTracker {
    private usage = new Map<string, UsageRow>();
    private apiKey = new Map<string, ApiKeyRow>();
    private proxyBytes = new Map<string, ProxyBytesRow>();

    constructor(
        private store: MetricsStore,
        private clock: Clock,
        private logger: Logger,
    ) {}

    private today(): string {
        return new Date(this.clock.now()).toISOString().slice(0, 10);
    }

    public recordResolve(r: ResolveRecord): void {
        const day = this.today();
        const k = `${day}${SEP}${r.platform}${SEP}${r.outcome}${SEP}${r.cache}${SEP}${r.uaClass}`;
        const e = this.usage.get(k);
        if (e) e.count += 1;
        else
            this.usage.set(k, {
                day,
                platform: r.platform,
                outcome: r.outcome,
                cache: r.cache,
                uaClass: r.uaClass,
                count: 1,
            });
    }

    public recordOutcome(outcome: ResolveOutcome, uaClass: string): void {
        if (outcome.status === 'no-adapter') {
            this.recordResolve({
                platform: 'none',
                outcome: 'no-adapter',
                cache: 'n/a',
                uaClass,
            });
            return;
        }
        this.recordResolve({
            platform: outcome.platform,
            outcome: outcome.status,
            cache:
                outcome.status === 'ok'
                    ? outcome.cacheHit
                        ? 'hit'
                        : 'miss'
                    : 'n/a',
            uaClass,
        });
    }

    public recordApiKey(keyId: string): void {
        const day = this.today();
        const k = `${day}${SEP}${keyId}`;
        const e = this.apiKey.get(k);
        if (e) e.count += 1;
        else this.apiKey.set(k, {day, keyId, count: 1});
    }

    public recordProxyBytes(platform: string, bytes: number): void {
        const day = this.today();
        const k = `${day}${SEP}${platform}`;
        const e = this.proxyBytes.get(k);
        if (e) {
            e.bytes += bytes;
            e.requests += 1;
        } else this.proxyBytes.set(k, {day, platform, bytes, requests: 1});
    }

    public flush(): void {
        if (!this.usage.size && !this.apiKey.size && !this.proxyBytes.size)
            return;
        const usage = this.usage;
        const apiKey = this.apiKey;
        const proxyBytes = this.proxyBytes;
        this.usage = new Map();
        this.apiKey = new Map();
        this.proxyBytes = new Map();
        try {
            this.store.flush({
                usage: [...usage.values()],
                apiKey: [...apiKey.values()],
                proxyBytes: [...proxyBytes.values()],
            });
        } catch (err) {
            this.mergeBack(usage, apiKey, proxyBytes);
            this.logger.warn(
                {err: String(err)},
                'usage flush failed, retained for retry',
            );
        }
    }

    private mergeBack(
        usage: Map<string, UsageRow>,
        apiKey: Map<string, ApiKeyRow>,
        proxyBytes: Map<string, ProxyBytesRow>,
    ): void {
        for (const [k, r] of usage) {
            const e = this.usage.get(k);
            if (e) e.count += r.count;
            else this.usage.set(k, r);
        }
        for (const [k, r] of apiKey) {
            const e = this.apiKey.get(k);
            if (e) e.count += r.count;
            else this.apiKey.set(k, r);
        }
        for (const [k, r] of proxyBytes) {
            const e = this.proxyBytes.get(k);
            if (e) {
                e.bytes += r.bytes;
                e.requests += r.requests;
            } else this.proxyBytes.set(k, r);
        }
    }
}
