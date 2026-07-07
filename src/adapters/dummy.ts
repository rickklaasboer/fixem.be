import type { EmbedMetadata, PlatformAdapter } from "./types";

// Static test adapter for example.com — lets us smoke-test embeds end-to-end
// (including in production Discord) without any platform dependency.
export function createDummyAdapter(): PlatformAdapter {
  return {
    name: "dummy",
    match(url) {
      return url.hostname === "example.com" || url.hostname === "www.example.com";
    },
    canonicalize(url) {
      return `https://example.com${url.pathname.replace(/\/$/, "") || "/"}`;
    },
    async resolve(url): Promise<EmbedMetadata> {
      return {
        kind: "image",
        title: "fixem.be works! 🎉",
        description: "This is the dummy adapter. If you can read this in an embed, crawler routing, resolving, caching and rendering are all working.",
        author: { name: "fixem.be", url: "https://fixem.be" },
        siteName: "example.com",
        themeColor: "#5865F2",
        image: { url: "https://placehold.co/1200x630/5865F2/ffffff.png?text=fixem.be", width: 1200, height: 630 },
        originalUrl: this.canonicalize(url),
      };
    },
  };
}
