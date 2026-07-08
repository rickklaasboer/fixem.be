import {describe, expect, test} from 'bun:test';
import {Hono} from 'hono';

describe('scaffold', () => {
    test('hono app responds', async () => {
        const app = new Hono();
        app.get('/', (c) => c.text('ok'));
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
    });
});
