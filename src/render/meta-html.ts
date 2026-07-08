import type { EmbedMetadata } from "../adapters/types";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tag(kind: "property" | "name", key: string, value: string | number): string {
  return `<meta ${kind}="${key}" content="${esc(String(value))}">`;
}

// Preview-only diagnostic for a URL that no adapter matched. A crawler gets a
// bare 302 for these (no embed to build), which is invisible when you append
// ?fixem=preview to debug — so instead of silently redirecting, explain why.
const SUPPORTED = "Reddit · Bluesky · X (Twitter) · Threads · Instagram · TikTok · Twitch clips";
export function renderPreviewNoAdapter(targetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fixem.be — no adapter matched</title>
<style>
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f7f7f5;color:#16171d;font:14px/1.6 ui-monospace,"JetBrains Mono",monospace}
main{max-width:560px}
h1{font-size:22px;color:#5058e0;letter-spacing:-.02em;margin:0 0 12px}
p{color:#6a6d78;margin:0 0 12px}
b{color:#16171d;font-weight:400}
code{background:#fff;border:1px solid #e2e2dd;border-radius:6px;padding:2px 6px;color:#5058e0}
.url{word-break:break-all}
a{color:#5058e0;text-decoration:none}a:hover{text-decoration:underline}
.tag{display:inline-block;font-size:12px;color:#5058e0;border:1px solid #5058e0;border-radius:4px;padding:1px 7px;margin-bottom:14px}
</style>
</head>
<body>
<main>
<span class="tag">?fixem=preview</span>
<h1>No adapter matched this URL</h1>
<p>fixem.be has no platform adapter for this link, so a crawler (Discord, etc.) receives a plain <code>302</code> redirect — <b>no rich embed is generated</b>. This page only appears in preview.</p>
<p class="url">Target: <a href="${esc(targetUrl)}">${esc(targetUrl)}</a></p>
<p><b>Supported:</b> individual <b>posts / clips</b> on ${esc(SUPPORTED)}.</p>
<p>Profile pages, home feeds, and other non-post URLs won't match — only a single post or clip does.</p>
</main>
</body>
</html>`;
}

export function minimalMeta(canonicalUrl: string): EmbedMetadata {
  return {
    kind: "link",
    title: canonicalUrl,
    siteName: "fixem.be",
    originalUrl: canonicalUrl,
  };
}

export function renderMetaHtml(
  meta: EmbedMetadata,
  opts: { oembedUrl: string; refresh?: boolean },
): string {
  const refresh = opts.refresh ?? true;
  const title = `${meta.nsfw ? "🔞 " : ""}${meta.title}`;
  const lines: string[] = [
    tag("property", "og:title", title),
    tag("property", "og:site_name", meta.siteName),
    tag("property", "og:url", meta.originalUrl),
  ];
  if (meta.description) lines.push(tag("property", "og:description", meta.description));
  if (meta.themeColor) lines.push(tag("name", "theme-color", meta.themeColor));

  if (meta.video) {
    lines.push(
      tag("property", "og:type", "video.other"),
      tag("property", "og:video", meta.video.url),
      tag("property", "og:video:secure_url", meta.video.url),
      tag("property", "og:video:type", meta.video.mimeType),
      tag("name", "twitter:card", "player"),
      tag("name", "twitter:player:stream", meta.video.url),
    );
    if (meta.video.width) {
      lines.push(
        tag("property", "og:video:width", meta.video.width),
        tag("name", "twitter:player:width", meta.video.width),
      );
    }
    if (meta.video.height) {
      lines.push(
        tag("property", "og:video:height", meta.video.height),
        tag("name", "twitter:player:height", meta.video.height),
      );
    }
  } else if (meta.image) {
    lines.push(tag("name", "twitter:card", "summary_large_image"));
  } else {
    lines.push(tag("name", "twitter:card", "summary"));
  }

  if (meta.image) {
    lines.push(
      tag("property", "og:image", meta.image.url),
      tag("name", "twitter:image", meta.image.url),
    );
    if (meta.image.width) lines.push(tag("property", "og:image:width", meta.image.width));
    if (meta.image.height) lines.push(tag("property", "og:image:height", meta.image.height));
  }

  // Body styling is self-contained (system monospace, no external font) — this
  // page is crawler-facing; a human only sees it via ?fixem=preview or if the
  // meta-refresh fails. It echoes the fixem.be landing palette.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${lines.join("\n")}
<link rel="alternate" type="application/json+oembed" href="${esc(opts.oembedUrl)}" title="${esc(meta.author?.name ?? meta.siteName)}">
${refresh ? `<meta http-equiv="refresh" content="0;url=${esc(meta.originalUrl)}">\n` : ""}<style>
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f7f7f5;color:#6a6d78;font:14px/1.6 ui-monospace,"JetBrains Mono",monospace}
a{color:#5058e0;text-decoration:none}a:hover{text-decoration:underline}
</style>
</head>
<body>
<p>Redirecting to <a href="${esc(meta.originalUrl)}">${esc(meta.originalUrl)}</a></p>
</body>
</html>`;
}
