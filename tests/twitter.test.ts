import { describe, expect, test } from "bun:test";
import { createTwitterAdapter, syndicationToken } from "../src/adapters/twitter";
import type { FetchFn } from "../src/adapters/types";
import photoTweet from "./fixtures/twitter/photo-tweet.json";
import videoTweet from "./fixtures/twitter/video-tweet.json";
import quoteTweet from "./fixtures/twitter/quote-tweet.json";
import tombstone from "./fixtures/twitter/tombstone.json";

function fakeFetch(body: unknown, requested: string[] = []): FetchFn {
  return (async (input: unknown) => {
    requested.push(String(input));
    return new Response(JSON.stringify(body));
  }) as unknown as FetchFn;
}

const TWEET_URL = new URL("https://x.com/janedoe/status/1785342865283856000");

describe("twitter adapter", () => {
  const a = createTwitterAdapter(fakeFetch(photoTweet));

  test("match covers twitter.com and x.com status URLs", () => {
    expect(a.match(TWEET_URL)).toBe(true);
    expect(a.match(new URL("https://twitter.com/janedoe/status/123/photo/1"))).toBe(true);
    expect(a.match(new URL("https://mobile.twitter.com/janedoe/statuses/123"))).toBe(true);
    expect(a.match(new URL("https://x.com/janedoe"))).toBe(false);
    expect(a.match(new URL("https://xcom.example/janedoe/status/123"))).toBe(false);
  });

  test("canonicalize strips trailing segments and query", () => {
    expect(a.canonicalize(new URL("https://twitter.com/janedoe/status/123/photo/1?s=20"))).toBe(
      "https://x.com/janedoe/status/123",
    );
  });

  test("syndication token matches the reference algorithm", () => {
    // reference value computed with the react-tweet formula
    expect(syndicationToken("1785342865283856000")).toBe(
      ((Number("1785342865283856000") / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ""),
    );
  });

  test("photo tweet: image kind, count marker, author", async () => {
    const requested: string[] = [];
    const ad = createTwitterAdapter(fakeFetch(photoTweet, requested));
    const m = await ad.resolve(TWEET_URL);
    expect(requested[0]).toContain("cdn.syndication.twimg.com/tweet-result?id=1785342865283856000");
    expect(requested[0]).toContain(`token=${syndicationToken("1785342865283856000")}`);
    expect(m.kind).toBe("image");
    expect(m.title).toBe("Jane Doe (@janedoe)");
    expect(m.image?.url).toBe("https://pbs.twimg.com/media/photo1.jpg");
    expect(m.image?.width).toBe(1600);
    expect(m.description).toBe("Two photos from the trip 📷 2 images");
    expect(m.siteName).toBe("X (Twitter)");
    expect(m.nsfw).toBe(false);
  });

  test("video tweet: highest-bitrate mp4, poster, nsfw flag", async () => {
    const ad = createTwitterAdapter(fakeFetch(videoTweet));
    const m = await ad.resolve(TWEET_URL);
    expect(m.kind).toBe("video");
    expect(m.video?.url).toBe("https://video.twimg.com/vid-2176.mp4");
    expect(m.video?.mimeType).toBe("video/mp4");
    expect(m.video?.width).toBe(1280);
    expect(m.video?.height).toBe(720);
    expect(m.image?.url).toBe("https://pbs.twimg.com/ext_tw_video_thumb/poster.jpg");
    expect(m.nsfw).toBe(true);
  });

  test("quote tweet appends quoted text", async () => {
    const ad = createTwitterAdapter(fakeFetch(quoteTweet));
    const m = await ad.resolve(TWEET_URL);
    expect(m.description).toBe("This. ↪ @dave: Original hot take about embeds.");
  });

  test("tombstone returns informative text-only embed", async () => {
    const ad = createTwitterAdapter(fakeFetch(tombstone));
    const m = await ad.resolve(TWEET_URL);
    expect(m.kind).toBe("link");
    expect(m.title).toBe("@janedoe");
    expect(m.nsfw).toBe(true);
    expect(m.ttlSeconds).toBe(600);
    expect(m.description).toContain("unavailable");
  });

  test("empty response throws", async () => {
    const ad = createTwitterAdapter(fakeFetch({}));
    expect(ad.resolve(TWEET_URL)).rejects.toThrow("twitter: tweet unavailable");
  });
});
