import type { FetchFn } from "./types";
import { CHROME_UA } from "../lib/http";

// Best-effort Instagram fallback via snapsave.app (a public media-downloader
// site) for when our own fetch is login-walled. THIRD-PARTY & FRAGILE: it depends
// on snapsave.app + its rapidcdn.app delivery CDN staying up and not rotating
// their scheme; it's opt-in (INSTAGRAM_SNAPSAVE) and degrades to null on any
// failure. snapsave's response is a custom-obfuscated JS blob — we reimplement
// its decoder as a PURE data transform and never eval the third-party code.

const SNAPSAVE_URL = "https://snapsave.app/action.php?lang=en";
const CHARSET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";
const V2_RE = /https:\/\/d\.rapidcdn\.app\/v2\?token=[A-Za-z0-9._-]+/g;
const THUMB_RE = /https:\/\/d\.rapidcdn\.app\/thumb\?token=[A-Za-z0-9._-]+/;

export interface SnapsaveMedia {
  kind: "video" | "image";
  mediaUrl: string; // rapidcdn.app proxy link — Discord fetches it directly
  thumbnailUrl?: string;
  count: number; // number of media items (carousel)
}

// Base-e → base-f digit re-encoding, faithful to snapsave's `_0xe*` function.
function baseConvert(d: string, e: number, f: number): string {
  const g = CHARSET.split("");
  const inAlpha = g.slice(0, e);
  const outAlpha = g.slice(0, f);
  let value = d
    .split("")
    .reverse()
    .reduce((acc, ch, i) => (inAlpha.indexOf(ch) !== -1 ? acc + inAlpha.indexOf(ch) * Math.pow(e, i) : acc), 0);
  let out = "";
  while (value > 0) {
    out = outAlpha[value % f]! + out;
    value = (value - (value % f)) / f;
  }
  return out || "0";
}

// Reimplements snapsave's outer decoder `function(h,u,n,t,e,r){…}` — pure, no eval.
export function deobfuscateSnapsave(blob: string): string | null {
  const m = blob.match(/\}\("([^"]*)",(\d+),"([^"]*)",(\d+),(\d+),(\d+)\)/);
  if (!m) return null;
  const h = m[1]!;
  const n = m[3]!;
  const t = Number(m[4]);
  const e = Number(m[5]);
  try {
    let r = "";
    for (let i = 0, len = h.length; i < len; i++) {
      let s = "";
      while (h[i] !== n[e]) {
        s += h[i];
        i++;
      }
      for (let j = 0; j < n.length; j++) s = s.replaceAll(n[j]!, String(j));
      r += String.fromCharCode(Number(baseConvert(s, e, 10)) - t);
    }
    return decodeURIComponent(escape(r));
  } catch {
    return null;
  }
}

// The media type isn't reliably in the HTML (both "Download Photo/Video" labels
// appear); read it from the rapidcdn JWT's inner Instagram URL extension.
function isVideoLink(v2url: string): boolean {
  const tok = v2url.match(/token=([A-Za-z0-9._-]+)/)?.[1];
  const payload = tok?.split(".")[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      url?: string;
      filename?: string;
    };
    return /\.mp4(\?|$)/i.test(String(json.url ?? json.filename ?? ""));
  } catch {
    return false;
  }
}

export function parseSnapsave(blob: string): SnapsaveMedia | null {
  const decoded = deobfuscateSnapsave(blob);
  if (!decoded) return null;
  const html = decoded.replaceAll("\\/", "/").replaceAll('\\"', '"').replaceAll("\\u0026", "&");
  const v2s = [...new Set([...html.matchAll(V2_RE)].map((x) => x[0]))];
  if (!v2s.length) return null;
  const mediaUrl = v2s[0]!;
  return {
    kind: isVideoLink(mediaUrl) ? "video" : "image",
    mediaUrl,
    thumbnailUrl: html.match(THUMB_RE)?.[0],
    count: v2s.length,
  };
}

export async function fetchSnapsaveMedia(
  instagramUrl: string,
  fetchFn: FetchFn = fetch,
): Promise<SnapsaveMedia | null> {
  try {
    const res = await fetchFn(SNAPSAVE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://snapsave.app",
        Referer: "https://snapsave.app/",
        "User-Agent": CHROME_UA,
      },
      body: "url=" + encodeURIComponent(instagramUrl),
    });
    if (!res.ok) return null;
    return parseSnapsave(await res.text());
  } catch {
    return null;
  }
}
