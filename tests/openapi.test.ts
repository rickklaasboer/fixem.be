import {describe, expect, test} from 'bun:test';
import createTestApp from './support/createTestApp';

// The API paths the server exposes under /api/v1 (single source of truth for
// the drift guard). Update this AND openapi.yaml together when adding a route.
const API_V1_PATHS = [
    '/api/v1/resolve',
    '/api/v1/canonical',
    '/api/v1/platforms',
    '/api/v1/health',
];

describe('GET /openapi.yaml', () => {
    test('is public (no bearer) and served as YAML', async () => {
        const app = createTestApp(); // no apiKeys → /api/v1 closed, but this is public
        const res = await app.request('/openapi.yaml');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('yaml');
        const text = await res.text();
        expect(text).toContain('openapi: 3.1.0');
    });

    test('is valid YAML and documents exactly the live /api/v1 routes (drift guard)', async () => {
        const text = await Bun.file(`${process.cwd()}/openapi.yaml`).text();
        // Bun.YAML.parse throws on invalid YAML — this is also the parse-validity
        // guard (the docs site's OpenAPI renderer parses the same file strictly).
        const spec = Bun.YAML.parse(text) as {paths: Record<string, unknown>};
        const documented = Object.keys(spec.paths);
        for (const p of API_V1_PATHS) {
            expect(documented).toContain(p);
        }
        // No /api/v1 path documented that the server doesn't serve.
        for (const d of documented) {
            if (d.startsWith('/api/v1/')) {
                expect(API_V1_PATHS).toContain(d);
            }
        }
    });
});
