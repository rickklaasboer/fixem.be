import {describe, expect, test} from 'bun:test';
import Crawler from '@/support/Crawler';

describe('Crawler', () => {
    test('detects known crawlers case-insensitively', () => {
        const crawler = new Crawler();
        expect(
            crawler.isCrawler(
                'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
            ),
        ).toBe(true);
        expect(crawler.isCrawler('TelegramBot (like TwitterBot)')).toBe(true);
        expect(crawler.isCrawler('Slackbot-LinkExpanding 1.0')).toBe(true);
        expect(crawler.isCrawler('Twitterbot/1.0')).toBe(true);
        expect(crawler.isCrawler('facebookexternalhit/1.1')).toBe(true);
        expect(crawler.isCrawler('WhatsApp/2.23.20')).toBe(true);
    });

    test('real browsers and missing UA are not crawlers', () => {
        const crawler = new Crawler();
        expect(
            crawler.isCrawler(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
            ),
        ).toBe(false);
        expect(crawler.isCrawler(undefined)).toBe(false);
        expect(crawler.isCrawler(null)).toBe(false);
        expect(crawler.isCrawler('')).toBe(false);
    });

    test('extra patterns from config are honored', () => {
        const crawler = new Crawler();
        expect(crawler.isCrawler('MyCustomBot/1.0', ['mycustombot'])).toBe(
            true,
        );
        expect(crawler.isCrawler('MyCustomBot/1.0', [])).toBe(false);
    });
});
