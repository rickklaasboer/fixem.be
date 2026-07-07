export type ParsedTarget =
  | { ok: true; url: URL }
  | { ok: false; reason: "unparseable" | "double-encoded" | "bad-scheme" };

const SCHEME_RE = /^(https?):\/+/i;
// bare host like 'www.tiktok.com/...' — at least one dot + TLD, and a path segment is required:
// content URLs always have one, and this keeps stray requests like /favicon.ico from parsing as a host.
const BARE_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i;

function tryDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseTargetUrl(pathname: string, search: string): ParsedTarget {
  let raw = pathname.replace(/^\/+/, "");

  if (raw.includes("%")) {
    const decoded = tryDecode(raw);
    if (decoded === null) return { ok: false, reason: "unparseable" };
    // after one decode, an encoded scheme/separator means the input was double-encoded
    if (/^https?%3a/i.test(decoded) || /%2f/i.test(decoded)) {
      return { ok: false, reason: "double-encoded" };
    }
    raw = decoded;
  }

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1]!)) {
    return { ok: false, reason: "bad-scheme" };
  }

  if (SCHEME_RE.test(raw)) {
    raw = raw.replace(SCHEME_RE, (_, s: string) => `${s.toLowerCase()}://`);
  } else if (BARE_HOST_RE.test(raw)) {
    raw = `https://${raw}`;
  } else {
    return { ok: false, reason: "unparseable" };
  }

  const params = new URLSearchParams(search);
  params.delete("fixem");
  const qs = params.toString();
  const full = qs ? `${raw}${raw.includes("?") ? "&" : "?"}${qs}` : raw;

  let url: URL;
  try {
    url = new URL(full);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "bad-scheme" };
  }
  if (!url.hostname.includes(".")) return { ok: false, reason: "unparseable" };
  return { ok: true, url };
}
