export type Maybe<T> = T | null | undefined;
export type Env = Record<string, string | undefined>;

export function getEnvString(env: Env, key: string): Maybe<string>;
export function getEnvString(env: Env, key: string, fallback: string): string;
export function getEnvString(
    env: Env,
    key: string,
    fallback?: string,
): Maybe<string> {
    const value = env[key];
    // Empty string counts as absent (the codebase's `||`-not-`??` rule): a copied
    // .env.example leaves blanks that must fall back to the default, never leak "".
    return value !== undefined && value !== '' ? value : fallback;
}

export function getEnvInt(env: Env, key: string): Maybe<number>;
export function getEnvInt(env: Env, key: string, fallback: number): number;
export function getEnvInt(
    env: Env,
    key: string,
    fallback?: number,
): Maybe<number> {
    const value = Number.parseInt(String(env[key]), 10);
    return Number.isFinite(value) ? value : fallback;
}

// Min-floor guard: an operator typo (RATE_LIMIT_PER_MIN=0) must not brick the
// service — sub-floor values fall back to the default rather than being honoured.
export function getEnvIntMin(
    env: Env,
    key: string,
    fallback: number,
    min: number,
): number {
    const value = getEnvInt(env, key, fallback);
    return value < min ? fallback : value;
}

export function getEnvBool(env: Env, key: string): Maybe<boolean>;
export function getEnvBool(env: Env, key: string, fallback: boolean): boolean;
export function getEnvBool(
    env: Env,
    key: string,
    fallback?: boolean,
): Maybe<boolean> {
    const value = String(env[key]).trim();
    if (/^(?:y|yes|true|1|on)$/i.test(value)) return true;
    if (/^(?:n|no|false|0|off)$/i.test(value)) return false;
    return fallback;
}

// csv split / trim / drop-empties (allowlists, API keys, extra crawler UAs)
export function getEnvList(
    env: Env,
    key: string,
    fallback: string[] = [],
): string[] {
    const value = getEnvString(env, key);
    return value
        ? value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        : fallback;
}
