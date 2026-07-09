import {injectable} from 'tsyringe';
import type {Context} from 'hono';

/**
 * Serves the committed `openapi.yaml` (repo root) verbatim as the single
 * source of truth for the API contract. Public + unauthenticated — the same
 * tier as /oembed and /healthz — so the external docs site and any consumer
 * wanting codegen fetch one canonical document.
 */
@injectable()
export default class OpenApiController {
    public async spec(c: Context): Promise<Response> {
        const text = await Bun.file(`${process.cwd()}/openapi.yaml`).text();
        return c.body(text, 200, {
            'Content-Type': 'application/yaml; charset=utf-8',
        });
    }
}
