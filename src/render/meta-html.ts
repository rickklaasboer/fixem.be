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

// Shared webfont setup for the human-facing ?fixem=preview pages (matches the
// landing page). The crawler-facing redirect page stays external-font-free.
const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">`;
const SANS = `"DM Sans",system-ui,sans-serif`;
const TITLE_FONT = `"Montserrat",sans-serif`;
const MONO = `ui-monospace,"JetBrains Mono",monospace`;
export function renderPreviewNoAdapter(targetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fixem.be — no adapter matched</title>
${FONT_LINKS}
<style>
:root{color-scheme:light}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f7f7f5;color:#16171d;font:14px/1.6 ${SANS}}
main{max-width:560px}
h1{font-family:${TITLE_FONT};font-size:22px;color:#5058e0;letter-spacing:-.02em;margin:0 0 12px}
p{color:#6a6d78;margin:0 0 12px}
b{color:#16171d;font-weight:400}
code{font:13px/1.6 ${MONO};background:#fff;border:1px solid #e2e2dd;border-radius:6px;padding:2px 6px;color:#5058e0}
.url{word-break:break-all;font-family:${MONO};font-size:13px}
a{color:#5058e0;text-decoration:none}a:hover{text-decoration:underline}
.tag{display:inline-block;font-family:${MONO};font-size:12px;color:#5058e0;border:1px solid #5058e0;border-radius:4px;padding:1px 7px;margin-bottom:14px}
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

function dims(m: { width?: number; height?: number }): string {
  return m.width && m.height ? ` (${m.width}×${m.height})` : "";
}

// Rich debug view for ?fixem=preview on a MATCHED url: the resolution outcome,
// a visual embed card, the parsed metadata, and the exact crawler HTML Discord
// would receive. Not crawler-facing — humans only reach it via ?fixem=preview.
export function renderPreviewReport(opts: {
  platform: string;
  status: "ok" | "degraded";
  cacheHit?: boolean;
  reason?: string;
  canonicalUrl: string;
  meta: EmbedMetadata;
  oembedUrl: string;
}): string {
  const { meta } = opts;
  const accent = meta.themeColor || "#5058e0";
  const crawlerHtml = renderMetaHtml(meta, { oembedUrl: opts.oembedUrl, refresh: false });
  const statusLabel =
    opts.status === "ok" ? `ok · cache ${opts.cacheHit ? "hit" : "miss"}` : `degraded · ${opts.reason ?? "error"}`;
  const statusClass = opts.status === "ok" ? "ok" : "warn";

  const rows: [string, string][] = [["kind", meta.kind], ["title", meta.title]];
  if (meta.description) rows.push(["description", meta.description]);
  if (meta.author) rows.push(["author", meta.author.url ? `${meta.author.name} — ${meta.author.url}` : meta.author.name]);
  rows.push(["siteName", meta.siteName]);
  if (meta.themeColor) rows.push(["themeColor", meta.themeColor]);
  if (meta.image) rows.push(["image", `${meta.image.url}${dims(meta.image)}`]);
  if (meta.video) {
    const proxied = meta.video.url.includes("/v/") ? " · proxied via /v/" : "";
    rows.push(["video", `${meta.video.url}${dims(meta.video)} · ${meta.video.mimeType}${proxied}`]);
  }
  rows.push(["nsfw", String(meta.nsfw ?? false)]);
  if (meta.ttlSeconds !== undefined) rows.push(["ttlSeconds", String(meta.ttlSeconds)]);
  rows.push(["originalUrl", meta.originalUrl]);
  const fieldRows = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n");

  const media = meta.video
    ? `<video class="media" controls preload="metadata" src="${esc(meta.video.url)}"${meta.image ? ` poster="${esc(meta.image.url)}"` : ""}></video>`
    : meta.image
      ? `<img class="media" src="${esc(meta.image.url)}" alt="" loading="lazy">`
      : `<div class="nomedia">no image / video — link-only embed</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fixem.be preview — ${esc(meta.title)}</title>
${FONT_LINKS}
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;padding:24px;background:#f7f7f5;color:#16171d;font:14px/1.6 ${SANS};display:flex;justify-content:center}
main{width:100%;max-width:680px}
.tag{display:inline-block;font-family:${MONO};font-size:12px;color:#5058e0;border:1px solid #5058e0;border-radius:4px;padding:1px 7px}
h1{font-family:${TITLE_FONT};font-size:20px;color:#5058e0;letter-spacing:-.02em;margin:12px 0 4px}
h2{font-family:${TITLE_FONT};font-size:12px;font-weight:700;letter-spacing:.04em;color:#6a6d78;text-transform:uppercase;margin:26px 0 10px}
.status{font-size:13px;margin:0}
.status .ok{color:#1a7f37}.status .warn{color:#b5480f}
a{color:#5058e0;text-decoration:none;word-break:break-all}a:hover{text-decoration:underline}
.card{background:#fff;border:1px solid #e2e2dd;border-left:4px solid ${esc(accent)};border-radius:8px;padding:12px 14px;max-width:460px}
.card .site{font-size:12px;color:#6a6d78}
.card .ctitle{font-weight:700;margin:2px 0 6px;color:#16171d}
.card .cdesc{font-size:13px;color:#3a3d47;margin:0 0 8px;white-space:pre-wrap}
.media{max-width:100%;border-radius:6px;display:block;background:#f0f0ec;max-height:340px}
.nomedia{font-size:12px;color:#8a8d98;padding:8px 0}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e2dd;border-radius:8px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:7px 12px;font:13px/1.6 ${MONO};border-top:1px solid #eee}
tr:first-child th,tr:first-child td{border-top:none}
th{color:#6a6d78;font-weight:400;width:110px;white-space:nowrap}
td{color:#16171d;word-break:break-all}
pre{background:#fff;border:1px solid #e2e2dd;border-radius:8px;padding:12px 14px;overflow-x:auto;font:12px/1.6 ${MONO};color:#3a3d47;margin:0}
</style>
</head>
<body>
<main>
<span class="tag">?fixem=preview</span>
<h1>${esc(meta.title)}</h1>
<p class="status"><b>${esc(opts.platform)}</b> · <span class="${statusClass}">${esc(statusLabel)}</span></p>

<h2>Embed card</h2>
<div class="card">
<div class="site">${esc(meta.siteName)}${meta.nsfw ? " · 🔞 NSFW" : ""}</div>
<div class="ctitle">${esc(meta.title)}</div>
${meta.description ? `<div class="cdesc">${esc(meta.description)}</div>` : ""}
${media}
</div>

<h2>Metadata</h2>
<table>
${fieldRows}
</table>

<h2>Resolution</h2>
<table>
<tr><th>canonical</th><td><a href="${esc(meta.originalUrl)}">${esc(opts.canonicalUrl)}</a></td></tr>
<tr><th>oembed</th><td><a href="${esc(opts.oembedUrl)}">${esc(opts.oembedUrl)}</a></td></tr>
</table>

<h2>Crawler HTML</h2>
<pre>${esc(crawlerHtml)}</pre>
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
