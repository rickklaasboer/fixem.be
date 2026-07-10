// Version-fragile pinned platform web-client constants, relocated out of the
// adapter modules so the per-domain config classes can import them as their
// `fromEnv` fallbacks without pulling in adapter code.

export interface TwitchGqlConfig {
    clientId: string;
    clipTokenHash: string;
}

// Public web client constants (research §1c) — env-overridable via config.
export const TWITCH_GQL_DEFAULTS: TwitchGqlConfig = {
    clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    clipTokenHash:
        '36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11',
};

// react-tweet's syndication feature flags — cosmetic but required (research §2a).
export const SYNDICATION_FEATURES = [
    'tfw_timeline_list:',
    'tfw_follower_count_sunset:true',
    'tfw_tweet_edit_backend:on',
    'tfw_refsrc_session:on',
    'tfw_fosnr_soft_interventions_enabled:on',
    'tfw_show_birdwatch_pivots_enabled:on',
    'tfw_show_business_verified_badge:on',
    'tfw_duplicate_scribes_to_settings:on',
    'tfw_use_profile_image_shape_enabled:on',
    'tfw_show_blue_verified_badge:on',
    'tfw_legacy_timeline_sunset:true',
    'tfw_show_gov_verified_badge:on',
    'tfw_show_business_affiliate_badge:on',
    'tfw_tweet_edit_frontend:on',
].join(';');

// Version-fragile pinned web-client constants. Meta rotates these a few times a
// year, so they're externalized: breakage becomes a config change, not a code
// change (matches how twitch.ts exports TWITCH_GQL_DEFAULTS).
export const THREADS_DEFAULTS = {
    lsd: 'XudMkvWGqcnLxbgeR25f3V',
    // Refreshed 2026-07: the post query was renamed BarcelonaPostPageQuery →
    // BarcelonaPostPageDirectQuery (doc_id changed to match). Verify/refresh from
    // the Threads web bundles when Meta rotates these.
    docId: '36633640579617733',
    appId: '238260118697367',
    friendlyName: 'BarcelonaPostPageDirectQuery',
};

export const TIKTOK_DEFAULTS = {
    rehydrationScriptId: '__UNIVERSAL_DATA_FOR_REHYDRATION__',
    // `mobileApiHost`/`iid`/`deviceId` are wired for the future mobile-API
    // fallback (research §3 Option B); the current implementation uses only the
    // web rehydration scrape (Option A).
    mobileApiHost: 'api22-normal-c-alisg.tiktokv.com',
    iid: '7318518857994389254',
    deviceId: '7318517321748022790',
};

// Version-fragile pinned web-client constants. Meta rotates these a few times a
// year, so they're externalized: breakage becomes a config change, not a code
// change (mirrors threads.ts's THREADS_DEFAULTS).
export const INSTAGRAM_DEFAULTS = {
    docId: '25531498899829322',
    appId: '936619743392459',
    friendlyName: 'PolarisPostActionLoadPostQueryQuery',
};

// Default CDN host allowlist for the /v/ proxy (research: platform media CDNs).
// Overridable via PROXY_HOST_ALLOWLIST. Entries are lowercase suffix matches.
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
