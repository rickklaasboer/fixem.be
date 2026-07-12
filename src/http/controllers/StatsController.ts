import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import MetricsStore from '@/services/metrics/MetricsStore';
import Clock from '@/services/Clock';

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read-only admin view over the usage rollups. Auth is applied upstream by
 * StatsAuthMiddleware. Default range is the last 30 days (UTC).
 */
@injectable()
export default class StatsController {
    constructor(
        private store: MetricsStore,
        private clock: Clock,
    ) {}

    private dayOf(ms: number): string {
        return new Date(ms).toISOString().slice(0, 10);
    }

    private range(c: Context): {from: string; to: string} | null {
        const now = this.clock.now();
        const from = c.req.query('from') ?? this.dayOf(now - 29 * DAY_MS);
        const to = c.req.query('to') ?? this.dayOf(now);
        if (!DAY_RE.test(from) || !DAY_RE.test(to)) return null;
        return {from, to};
    }

    public usage(c: Context): Response {
        const r = this.range(c);
        if (!r) return c.json({error: 'invalid date range'}, 400);
        return c.json({
            from: r.from,
            to: r.to,
            rows: this.store.usageBetween(r.from, r.to),
        });
    }

    public keys(c: Context): Response {
        const r = this.range(c);
        if (!r) return c.json({error: 'invalid date range'}, 400);
        return c.json({
            from: r.from,
            to: r.to,
            rows: this.store.apiKeysBetween(r.from, r.to),
        });
    }

    public bandwidth(c: Context): Response {
        const r = this.range(c);
        if (!r) return c.json({error: 'invalid date range'}, 400);
        return c.json({
            from: r.from,
            to: r.to,
            rows: this.store.proxyBytesBetween(r.from, r.to),
        });
    }
}
