import {
    INSTAGRAM_DEFAULTS,
    SYNDICATION_FEATURES,
    THREADS_DEFAULTS,
    TIKTOK_DEFAULTS,
    TWITCH_GQL_DEFAULTS,
    type InstagramConfig,
    type ThreadsConfig,
    type TiktokConfig,
} from '@/config/defaults';

export default class Config {
    public readonly port!: number;
    public readonly redisUrl!: string;
    public readonly cacheTtlSeconds!: number;
    public readonly resolveTimeoutMs!: number;
    public readonly rateLimitPerMin!: number;
    public readonly publicBaseUrl!: string;
    public readonly extraCrawlerUas!: string[];
    // Public API v1 surface.
    public readonly apiKeys!: string[];
    public readonly apiRateLimitPerMin!: number;
    public readonly batchMaxUrls!: number;
    public readonly twitchClientId?: string;
    public readonly twitchClientSecret?: string;
    public readonly twitchGqlClientId!: string;
    public readonly twitchGqlClipHash!: string;
    public readonly twitterSyndicationFeatures!: string;
    public readonly redditClientId?: string;
    public readonly redditClientSecret?: string;
    public readonly redditProxyUrl?: string;
    public readonly redditHttpProxy?: string;
    public readonly proxySecret!: string;
    public readonly proxyHostAllowlist!: string[];
    public readonly proxyMaxConcurrent!: number;
    public readonly proxyMaxBytes!: number;
    public readonly proxyTimeoutMs!: number;
    public readonly threads!: ThreadsConfig;
    public readonly tiktok!: TiktokConfig;
    public readonly instagram!: InstagramConfig;
}

export const DEFAULT_PROXY_ALLOWLIST = [
    'cdninstagram.com',
    'fbcdn.net',
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'tiktokcdn-eu.com',
    'tiktokv.com',
    'tiktokv.eu',
    'tiktok.com',
    'muscdn.com',
    'byteoversea.com',
    'video.twimg.com',
];

function int(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

// An operator typo (e.g. RATE_LIMIT_PER_MIN=0) must not brick the service:
// values below a sane floor fall back to the default.
function intMin(
    value: string | undefined,
    fallback: number,
    min: number,
): number {
    const n = int(value, fallback);
    return n < min ? fallback : n;
}

export function loadConfig(
    env: Record<string, string | undefined> = process.env,
): Config {
    return Object.assign(new Config(), {
        port: intMin(env.PORT, 3000, 1),
        redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
        cacheTtlSeconds: intMin(env.CACHE_TTL_SECONDS, 14400, 1),
        resolveTimeoutMs: intMin(env.RESOLVE_TIMEOUT_MS, 5000, 100),
        rateLimitPerMin: intMin(env.RATE_LIMIT_PER_MIN, 60, 1),
        publicBaseUrl: env.PUBLIC_BASE_URL ?? 'https://fixem.be',
        extraCrawlerUas: (env.EXTRA_CRAWLER_UAS ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        // Comma-separated set of valid bearer keys for /api/v1/*; empty = closed.
        // Same parse shape as proxyHostAllowlist (trim, drop empties).
        apiKeys: (env.API_KEYS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        apiRateLimitPerMin: intMin(env.API_RATE_LIMIT_PER_MIN, 60, 1),
        batchMaxUrls: intMin(env.BATCH_MAX_URLS, 20, 1),
        twitchClientId: env.TWITCH_CLIENT_ID,
        twitchClientSecret: env.TWITCH_CLIENT_SECRET,
        // `||` (not `??`): a copied .env.example leaves these as "", which must
        // still fall back to the pinned defaults.
        twitchGqlClientId:
            env.TWITCH_GQL_CLIENT_ID || TWITCH_GQL_DEFAULTS.clientId,
        twitchGqlClipHash:
            env.TWITCH_GQL_CLIP_HASH || TWITCH_GQL_DEFAULTS.clipTokenHash,
        // `||` (not `??`): a copied .env.example leaves this as "", which must
        // still fall back to the pinned default flag string.
        twitterSyndicationFeatures:
            env.TWITTER_SYNDICATION_FEATURES || SYNDICATION_FEATURES,
        redditClientId: env.REDDIT_CLIENT_ID,
        redditClientSecret: env.REDDIT_CLIENT_SECRET,
        // Optional offloads for anonymous reddit fetches; unset means direct fetch.
        redditProxyUrl: env.REDDIT_PROXY_URL || undefined,
        redditHttpProxy: env.REDDIT_HTTP_PROXY || undefined,
        proxySecret: env.PROXY_SECRET ?? '',
        proxyHostAllowlist: env.PROXY_HOST_ALLOWLIST
            ? env.PROXY_HOST_ALLOWLIST.split(',')
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
            : DEFAULT_PROXY_ALLOWLIST,
        proxyMaxConcurrent: intMin(env.PROXY_MAX_CONCURRENT, 32, 1),
        proxyMaxBytes: intMin(env.PROXY_MAX_BYTES, 104857600, 1),
        proxyTimeoutMs: intMin(env.PROXY_TIMEOUT_MS, 10000, 100),
        // Version-fragile pinned web-client constants (see each adapter's *_DEFAULTS).
        // `||` (not `??`): a copied .env.example leaves these blank, which must still
        // fall back to the pinned defaults.
        threads: {
            lsd: env.THREADS_LSD || THREADS_DEFAULTS.lsd,
            docId: env.THREADS_DOC_ID || THREADS_DEFAULTS.docId,
            appId: env.THREADS_APP_ID || THREADS_DEFAULTS.appId,
            friendlyName:
                env.THREADS_FRIENDLY_NAME || THREADS_DEFAULTS.friendlyName,
        },
        tiktok: {
            rehydrationScriptId:
                env.TIKTOK_REHYDRATION_SCRIPT_ID ||
                TIKTOK_DEFAULTS.rehydrationScriptId,
            mobileApiHost:
                env.TIKTOK_MOBILE_API_HOST || TIKTOK_DEFAULTS.mobileApiHost,
            iid: env.TIKTOK_IID || TIKTOK_DEFAULTS.iid,
            deviceId: env.TIKTOK_DEVICE_ID || TIKTOK_DEFAULTS.deviceId,
        },
        instagram: {
            docId: env.INSTAGRAM_DOC_ID || INSTAGRAM_DEFAULTS.docId,
            appId: env.INSTAGRAM_APP_ID || INSTAGRAM_DEFAULTS.appId,
            friendlyName:
                env.INSTAGRAM_FRIENDLY_NAME || INSTAGRAM_DEFAULTS.friendlyName,
            // Optional residential-proxy offload; unset means direct fetch.
            proxyUrl: env.INSTAGRAM_PROXY_URL || undefined,
            // Optional logged-in session cookie (burner sessionid=...); authenticates
            // the GraphQL call past the login wall. A full account credential — keep secret.
            cookie: env.INSTAGRAM_COOKIE || undefined,
            // Opt-in snapsave.app fallback when our own fetch is login-walled.
            snapsave: env.INSTAGRAM_SNAPSAVE === 'true',
        },
    });
}
