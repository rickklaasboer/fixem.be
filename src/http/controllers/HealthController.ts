import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import LandingPage from '@/services/LandingPage';
import Cache from '@/services/cache/Cache';

/**
 * Serves the landing page and the liveness/readiness probe.
 */
@injectable()
export default class HealthController {
    constructor(
        private landing: LandingPage,
        private cache: Cache,
    ) {}

    /**
     * `GET /` — the static landing page.
     */
    public index(c: Context): Response {
        return c.html(this.landing.html());
    }

    /**
     * `GET /healthz` — liveness probe, including Redis reachability.
     */
    public async healthz(c: Context): Promise<Response> {
        return c.json({ok: true, redis: await this.cache.ping()});
    }
}
