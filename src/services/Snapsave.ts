import {injectable} from 'tsyringe';
import HttpClient, {CHROME_UA} from '@/services/HttpClient';

// Best-effort Instagram fallback via snapsave.app (a public media-downloader
// site) for when our own fetch is login-walled. THIRD-PARTY & FRAGILE: it depends
// on snapsave.app + its rapidcdn.app delivery CDN staying up and not rotating
// their scheme; it's opt-in (INSTAGRAM_SNAPSAVE) and degrades to null on any
// failure. snapsave's response is a custom-obfuscated JS blob — we reimplement
// its decoder as a PURE data transform and never eval the third-party code.

const SNAPSAVE_URL = 'https://snapsave.app/action.php?lang=en';
const CHARSET =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';
const V2_RE = /https:\/\/d\.rapidcdn\.app\/v2\?token=[A-Za-z0-9._-]+/g;
const THUMB_RE = /https:\/\/d\.rapidcdn\.app\/thumb\?token=[A-Za-z0-9._-]+/;

export interface SnapsaveMedia {
    kind: 'video' | 'image';
    mediaUrl: string; // rapidcdn.app proxy link — Discord fetches it directly
    thumbnailUrl?: string;
    count: number; // number of media items (carousel)
}

/**
 * Third-party snapsave.app fallback: a pure decoder for its obfuscated response
 * plus the fetch that drives it. A collaborator (not a platform adapter) that
 * InstagramAdapter uses as an opt-in last resort past the login wall.
 */
@injectable()
export default class Snapsave {
    constructor(private http: HttpClient) {}

    /**
     * Base-e → base-f digit re-encoding, faithful to snapsave's `_0xe*` function.
     */
    private static baseConvert(d: string, e: number, f: number): string {
        const g = CHARSET.split('');
        const inAlpha = g.slice(0, e);
        const outAlpha = g.slice(0, f);
        let value = d
            .split('')
            .reverse()
            .reduce(
                (acc, ch, i) =>
                    inAlpha.indexOf(ch) !== -1
                        ? acc + inAlpha.indexOf(ch) * e ** i
                        : acc,
                0,
            );
        let out = '';
        while (value > 0) {
            out = outAlpha[value % f]! + out;
            value = (value - (value % f)) / f;
        }
        return out || '0';
    }

    /**
     * Reimplements snapsave's outer decoder `function(h,u,n,t,e,r){…}` — pure, no eval.
     */
    public static deobfuscate(blob: string): string | null {
        const m = blob.match(
            /\}\("([^"]*)",(\d+),"([^"]*)",(\d+),(\d+),(\d+)\)/,
        );
        if (!m) return null;
        const h = m[1]!;
        const n = m[3]!;
        const t = Number(m[4]);
        const e = Number(m[5]);
        try {
            let r = '';
            for (let i = 0, len = h.length; i < len; i++) {
                let s = '';
                // Bound by `len`: a well-formed blob ends every chunk with the delimiter
                // n[e], but a truncated/format-changed third-party response may not — an
                // unbounded `while (h[i] !== n[e])` would then walk past the end (h[i]
                // undefined, never equal to a defined delimiter) and spin forever,
                // blocking Bun's single event loop so the resolver timeout can't fire.
                while (i < len && h[i] !== n[e]) {
                    s += h[i];
                    i++;
                }
                for (let j = 0; j < n.length; j++)
                    s = s.replaceAll(n[j]!, String(j));
                r += String.fromCharCode(
                    Number(Snapsave.baseConvert(s, e, 10)) - t,
                );
            }
            return decodeURIComponent(escape(r));
        } catch {
            return null;
        }
    }

    /**
     * The media type isn't reliably in the HTML (both "Download Photo/Video"
     * labels appear); read it from the rapidcdn JWT's inner Instagram URL ext.
     */
    private static isVideoLink(v2url: string): boolean {
        const tok = v2url.match(/token=([A-Za-z0-9._-]+)/)?.[1];
        const payload = tok?.split('.')[1];
        if (!payload) return false;
        try {
            const json = JSON.parse(
                atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
            ) as {
                url?: string;
                filename?: string;
            };
            return /\.mp4(\?|$)/i.test(String(json.url ?? json.filename ?? ''));
        } catch {
            return false;
        }
    }

    /**
     * Decode + scrape the snapsave blob into a media descriptor (null if none).
     */
    public static parse(blob: string): SnapsaveMedia | null {
        const decoded = Snapsave.deobfuscate(blob);
        if (!decoded) return null;
        const html = decoded
            .replaceAll('\\/', '/')
            .replaceAll('\\"', '"')
            .replaceAll('\\u0026', '&');
        const v2s = [...new Set([...html.matchAll(V2_RE)].map((x) => x[0]))];
        if (!v2s.length) return null;
        const mediaUrl = v2s[0]!;
        return {
            kind: Snapsave.isVideoLink(mediaUrl) ? 'video' : 'image',
            mediaUrl,
            thumbnailUrl: html.match(THUMB_RE)?.[0],
            count: v2s.length,
        };
    }

    /**
     * POST the Instagram URL to snapsave.app and parse its response (null on
     * any non-ok/transport failure — never throws).
     */
    public async fetchMedia(
        canonical: string,
        signal?: AbortSignal,
    ): Promise<SnapsaveMedia | null> {
        try {
            const res = await this.http.fetch(SNAPSAVE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Origin: 'https://snapsave.app',
                    Referer: 'https://snapsave.app/',
                    'User-Agent': CHROME_UA,
                },
                body: `url=${encodeURIComponent(canonical)}`,
                signal,
            });
            if (!res.ok) return null;
            return Snapsave.parse(await res.text());
        } catch {
            return null;
        }
    }
}
