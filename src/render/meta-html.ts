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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
${lines.join("\n")}
<link rel="alternate" type="application/json+oembed" href="${esc(opts.oembedUrl)}" title="${esc(meta.author?.name ?? meta.siteName)}">
${refresh ? `<meta http-equiv="refresh" content="0;url=${esc(meta.originalUrl)}">\n` : ""}</head>
<body>
<p>Redirecting to <a href="${esc(meta.originalUrl)}">${esc(meta.originalUrl)}</a></p>
</body>
</html>`;
}
