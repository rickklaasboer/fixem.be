import type {FetchFn} from '../adapters/types';

// Shared outbound User-Agent for all platform API/redirect requests. A single
// honest identifier (with a contact URL) keeps upstreams from rate-limiting us
// as an anonymous scraper and avoids drift between adapters.
export const PLATFORM_UA = 'fixem.be/1.0 (embed fixer; +https://fixem.be)';

// Bind an AbortSignal onto a fetchFn so every request an adapter makes during
// one resolve is cancellable. The resolver aborts on its per-resolve timeout,
// so a hung upstream releases the socket instead of orphaning it. Returns the
// original fetchFn unchanged when there is no signal (tests inject their own
// fetchFn and pass none — this keeps their behavior identical).
export function withSignal(fetchFn: FetchFn, signal?: AbortSignal): FetchFn {
    if (!signal) return fetchFn;
    return ((input, init) => fetchFn(input, {...init, signal})) as FetchFn;
}

// A real desktop-browser UA. Meta (Threads/Instagram) rejects the honest
// PLATFORM_UA on its anonymous web endpoints, and the signed cdninstagram media
// URLs only replay when re-requested with a browser UA — so those adapters (and
// the /v/ proxy that fetches their media) send this instead.
export const FIREFOX_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';

// A real desktop Chrome UA. TikTok's web page (the __UNIVERSAL_DATA_FOR_REHYDRATION__
// scrape) rejects the honest PLATFORM_UA and short-link redirects behave differently
// for bots; its signed `/aweme/v1/play/` URLs are also IP/UA-locked and only replay
// when re-requested with a browser UA — so the TikTok adapter (and the /v/ proxy that
// fetches its media) send this instead.
export const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
