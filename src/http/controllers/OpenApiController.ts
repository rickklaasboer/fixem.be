import {singleton} from 'tsyringe';
import type {Context} from 'hono';

/**
 * Serves the committed `openapi.yaml` (repo root) verbatim as the single
 * source of truth for the API contract. Public + unauthenticated — the same
 * tier as /oembed and /healthz — so the external docs site and any consumer
 * wanting codegen fetch one canonical document.
 */
@singleton()
export default class OpenApiController {
    private cached: string | null = null;

    public async spec(c: Context): Promise<Response> {
        // The spec is committed & immutable at runtime — read it once, not per
        // request (this route is public, unauthenticated, and un-rate-limited).
        if (this.cached === null) {
            this.cached = await Bun.file(
                `${process.cwd()}/openapi.yaml`,
            ).text();
        }
        return c.body(this.cached, 200, {
            'Content-Type': 'application/yaml; charset=utf-8',
        });
    }
}
