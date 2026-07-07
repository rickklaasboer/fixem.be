const CRAWLER_PATTERNS = [
  "discordbot",
  "telegrambot",
  "slackbot",
  "twitterbot",
  "facebookexternalhit",
  "whatsapp",
];

export function isCrawler(
  ua: string | undefined | null,
  extra: string[] = [],
): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return [...CRAWLER_PATTERNS, ...extra].some((p) => lower.includes(p));
}
