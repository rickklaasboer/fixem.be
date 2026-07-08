import {describe, it, expect} from 'bun:test';
import LandingPage from '@/services/LandingPage';

describe('LandingPage', () => {
    it('html() returns non-empty string containing fixem', () => {
        const page = new LandingPage();
        const html = page.html();

        expect(html).toBeDefined();
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
        expect(html.toLowerCase()).toContain('fixem');
    });
});
