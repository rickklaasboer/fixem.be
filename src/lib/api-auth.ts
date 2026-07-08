// Constant-time comparison for API-key auth. Both inputs are hashed to a fixed
// 32 bytes first, so neither the byte comparison nor the raw input lengths leak
// timing information about the configured secret. Web Crypto only (no node:crypto),
// matching the rest of the codebase.
async function sha256(s: string): Promise<Uint8Array> {
    return new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    );
}

export async function secretsMatch(a: string, b: string): Promise<boolean> {
    const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
    let diff = 0;
    for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
    return diff === 0;
}
