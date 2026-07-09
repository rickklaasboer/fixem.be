/**
 * Constant-time API-key comparison. Both inputs are SHA-256'd to a fixed 32
 * bytes first, so neither the byte comparison nor the raw input lengths leak
 * timing information about the configured secret. Web Crypto only.
 */
export default class Secrets {
    private static async sha256(s: string): Promise<Uint8Array> {
        return new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
        );
    }

    /**
     * Whether two secrets are equal, in constant time.
     */
    public static async match(a: string, b: string): Promise<boolean> {
        const [ha, hb] = await Promise.all([
            Secrets.sha256(a),
            Secrets.sha256(b),
        ]);
        let diff = 0;
        for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
        return diff === 0;
    }

    /**
     * Hex SHA-256 of the input — a stable, non-reversible bucket id for a
     * secret (e.g. rate-limiting on an API key without storing it raw).
     */
    public static async hash(s: string): Promise<string> {
        const bytes = await Secrets.sha256(s);
        let hex = '';
        for (const b of bytes) hex += b.toString(16).padStart(2, '0');
        return hex;
    }

    /**
     * Extract the token from an `Authorization` header. Per RFC 6750 the scheme
     * is case-insensitive and one-or-more spaces may separate it from the token,
     * so parse leniently — a brittle `startsWith('Bearer ')` rejects legal headers.
     * Returns '' for a missing/non-bearer header. Shared by the auth + rate-limit
     * middleware so they agree on exactly which token a request carries.
     */
    public static bearer(header: string | null | undefined): string {
        const m = header?.match(/^Bearer\s+(.*)$/i);
        return m ? m[1]!.trim() : '';
    }
}
