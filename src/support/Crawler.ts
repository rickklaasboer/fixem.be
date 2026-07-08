import {singleton} from 'tsyringe';

/**
 * Detects link-preview crawlers from User-Agent headers.
 */
@singleton()
export default class Crawler {
    private static readonly CRAWLER_PATTERNS = [
        'discordbot',
        'telegrambot',
        'slackbot',
        'twitterbot',
        'facebookexternalhit',
        'whatsapp',
    ];

    public isCrawler(
        ua: string | undefined | null,
        extra: string[] = [],
    ): boolean {
        if (!ua) return false;
        const lower = ua.toLowerCase();
        return [...Crawler.CRAWLER_PATTERNS, ...extra].some((p) =>
            lower.includes(p),
        );
    }
}
