import { describe, expect, test } from "bun:test";
import { minimalMeta, renderMetaHtml } from "../src/render/meta-html";
import type { EmbedMetadata } from "../src/adapters/types";

const base: EmbedMetadata = {
  kind: "image",
  title: "A post",
  description: "Hello <world> & \"friends\"",
  author: { name: "u/someone", url: "https://example.com/u/someone" },
  siteName: "Reddit • r/pics",
  themeColor: "#FF4500",
  image: { url: "https://i.example.com/a.jpg", width: 1200, height: 800 },
  originalUrl: "https://www.reddit.com/r/pics/comments/abc",
};

describe("renderMetaHtml", () => {
  test("image post has OG + twitter tags and oembed link", () => {
    const html = renderMetaHtml(base, { oembedUrl: "https://fixem.be/oembed?url=x" });
    expect(html).toContain('<meta property="og:title" content="A post"');
    expect(html).toContain('<meta property="og:site_name" content="Reddit • r/pics"');
    expect(html).toContain('<meta property="og:image" content="https://i.example.com/a.jpg"');
    expect(html).toContain('<meta property="og:image:width" content="1200"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<meta name="theme-color" content="#FF4500"');
    expect(html).toContain('<meta property="og:url" content="https://www.reddit.com/r/pics/comments/abc"');
    expect(html).toContain('type="application/json+oembed"');
    expect(html).toContain('<meta http-equiv="refresh"');
  });

  test("escapes HTML in attribute values", () => {
    const html = renderMetaHtml(base, { oembedUrl: "https://fixem.be/oembed?url=x" });
    expect(html).toContain("Hello &lt;world&gt; &amp; &quot;friends&quot;");
    expect(html).not.toContain('Hello <world>');
  });

  test("video post uses player card and og:video tags", () => {
    const meta: EmbedMetadata = {
      ...base,
      kind: "video",
      video: { url: "https://v.example.com/v.mp4", width: 720, height: 1280, mimeType: "video/mp4" },
    };
    const html = renderMetaHtml(meta, { oembedUrl: "https://fixem.be/oembed?url=x" });
    expect(html).toContain('<meta property="og:video" content="https://v.example.com/v.mp4"');
    expect(html).toContain('<meta property="og:video:type" content="video/mp4"');
    expect(html).toContain('<meta name="twitter:card" content="player"');
    expect(html).toContain('<meta name="twitter:player:width" content="720"');
  });

  test("nsfw adds marker to title", () => {
    const html = renderMetaHtml({ ...base, nsfw: true }, { oembedUrl: "https://fixem.be/oembed?url=x" });
    expect(html).toContain('content="🔞 A post"');
  });

  test("no-media post falls back to summary card, omits image tags", () => {
    const meta: EmbedMetadata = { kind: "link", title: "T", siteName: "S", originalUrl: "https://e.com/x" };
    const html = renderMetaHtml(meta, { oembedUrl: "https://fixem.be/oembed?url=x" });
    expect(html).toContain('<meta name="twitter:card" content="summary"');
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("og:video");
  });

  test("minimalMeta builds a link-kind fallback", () => {
    const m = minimalMeta("https://www.tiktok.com/@user/video/1");
    expect(m.kind).toBe("link");
    expect(m.title).toBe("https://www.tiktok.com/@user/video/1");
    expect(m.originalUrl).toBe("https://www.tiktok.com/@user/video/1");
    expect(m.siteName).toBe("fixem.be");
  });
});
