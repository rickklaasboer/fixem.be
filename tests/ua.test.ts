import { describe, expect, test } from "bun:test";
import { isCrawler } from "../src/ua";

describe("isCrawler", () => {
  test("detects known crawlers case-insensitively", () => {
    expect(isCrawler("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe(true);
    expect(isCrawler("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isCrawler("Slackbot-LinkExpanding 1.0")).toBe(true);
    expect(isCrawler("Twitterbot/1.0")).toBe(true);
    expect(isCrawler("facebookexternalhit/1.1")).toBe(true);
    expect(isCrawler("WhatsApp/2.23.20")).toBe(true);
  });

  test("real browsers and missing UA are not crawlers", () => {
    expect(isCrawler("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")).toBe(false);
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler("")).toBe(false);
  });

  test("extra patterns from config are honored", () => {
    expect(isCrawler("MyCustomBot/1.0", ["mycustombot"])).toBe(true);
    expect(isCrawler("MyCustomBot/1.0", [])).toBe(false);
  });
});
