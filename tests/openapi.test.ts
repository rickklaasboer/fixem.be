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

    test('documents exactly the live /api/v1 routes (drift guard)', async () => {
        const text = await Bun.file(`${process.cwd()}/openapi.yaml`).text();
        // Path keys are the only 2-space-indented `/`-prefixed keys in the doc.
        const documented = new Set(
            [...text.matchAll(/^ {2}(\/[^\s:]+):/gm)].map((m) => m[1]!),
        );
        for (const p of API_V1_PATHS) {
            expect(documented.has(p)).toBe(true);
        }
        // No /api/v1 path documented that the server doesn't serve.
        for (const d of documented) {
            if (d.startsWith('/api/v1/')) {
                expect(API_V1_PATHS).toContain(d);
            }
        }
    });
});
