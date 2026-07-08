import {describe, expect, test} from 'bun:test';
import createTestApp from './support/createTestApp';

const BROWSER_UA =
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const DISCORD_UA =
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';

// End-to-end smoke: exercises the same container wiring + route bindings that
// bootstrap() uses in production (createTestApp calls routes(server, child)),
// proving the graph resolves and the app serves.
describe('smoke', () => {
    test('wired app serves the landing page', async () => {
        const app = createTestApp();
        const res = await app.request('/', {
            headers: {'User-Agent': BROWSER_UA},
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('fixem.be landing');
    });

    test('wired app reports health with redis reachability', async () => {
        const res = await createTestApp().request('/healthz');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ok: true, redis: true});
    });

    test('wired app serves an embed to a crawler', async () => {
        const res = await createTestApp().request(
            '/https://example.com/hello',
            {headers: {'User-Agent': DISCORD_UA}},
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('fixem.be works!');
    });
});
