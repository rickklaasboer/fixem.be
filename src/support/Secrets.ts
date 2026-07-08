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
}
