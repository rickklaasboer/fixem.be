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
    // Structural double-encoding check: an encoded scheme colon or slash
    // surviving one decode means the URL's *structure* was double-encoded.
    // Deeper double-encoding of ordinary characters intentionally passes
    // through — it may be a legitimate literal %-sequence in the target —
    // and any percent-sequence remaining in the hostname is either decoded
    // to a valid domain code point by the WHATWG host parser or causes
    // rejection: the final url.hostname is always the fully-decoded fetch
    // target that adapter matching (stage 2) sees.
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
  // `fixem` is our reserved namespace (the diagnostic hatch now lives at the
  // `/preview/` path, not this param). Strip it so a stray/legacy one never
  // leaks into the target URL we redirect to.
  params.delete("fixem");
  const qs = params.toString();
  // Re-attached params must land before any fragment, never inside it.
  const hashIdx = raw.indexOf("#");
  const [base, frag] = hashIdx >= 0 ? [raw.slice(0, hashIdx), raw.slice(hashIdx)] : [raw, ""];
  const full = qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}${frag}` : raw;

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
