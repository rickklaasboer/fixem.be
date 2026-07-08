export type FetchFn = typeof fetch;

// Shared outbound User-Agent for platform API/redirect requests (verbatim from lib/http).
export const PLATFORM_UA = 'fixem.be/1.0 (embed fixer; +https://fixem.be)';
export const FIREFOX_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';
export const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Thin fetch wrapper: applies a default honest User-Agent and centralizes JSON
 * fetching. Injected into adapters so tests supply a recorded-fixture fetch.
 */
export default class HttpClient {
    constructor(private fetchFn: FetchFn = fetch) {}

    /**
     * Fetch with the default PLATFORM_UA filled in when the caller sets none.
     */
    public fetch(input: string, init?: RequestInit): Promise<Response> {
        const headers = new Headers(init?.headers);
        if (!headers.has('User-Agent')) headers.set('User-Agent', PLATFORM_UA);
        return this.fetchFn(input, {...init, headers});
    }

    /**
     * Fetch and parse JSON; throw on a non-ok response.
     */
    public async getJson<T>(input: string, init?: RequestInit): Promise<T> {
        const res = await this.fetch(input, init);
        if (!res.ok) throw new Error(`request failed ${res.status}`);
        return (await res.json()) as T;
    }
}
