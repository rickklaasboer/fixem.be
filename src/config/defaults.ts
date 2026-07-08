// Version-fragile pinned platform web-client constants and their slice types,
// relocated out of the adapter modules so `Config` no longer has to import from
// adapters. This breaks the Config↔adapter import cycle that appears once the
// adapters inject `Config`.

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
export interface ThreadsConfig {
    lsd: string;
    docId: string;
    appId: string;
    friendlyName: string;
}

export const THREADS_DEFAULTS: ThreadsConfig = {
    lsd: 'XudMkvWGqcnLxbgeR25f3V',
    // Refreshed 2026-07: the post query was renamed BarcelonaPostPageQuery →
    // BarcelonaPostPageDirectQuery (doc_id changed to match). Verify/refresh from
    // the Threads web bundles when Meta rotates these.
    docId: '36633640579617733',
    appId: '238260118697367',
    friendlyName: 'BarcelonaPostPageDirectQuery',
};

export interface TiktokConfig {
    rehydrationScriptId: string;
    // Wired for the future mobile-API fallback (research §3 Option B); the current
    // implementation uses only the web rehydration scrape (Option A).
    mobileApiHost: string;
    iid: string;
    deviceId: string;
}

export const TIKTOK_DEFAULTS: TiktokConfig = {
    rehydrationScriptId: '__UNIVERSAL_DATA_FOR_REHYDRATION__',
    mobileApiHost: 'api22-normal-c-alisg.tiktokv.com',
    iid: '7318518857994389254',
    deviceId: '7318517321748022790',
};

// Version-fragile pinned web-client constants. Meta rotates these a few times a
// year, so they're externalized: breakage becomes a config change, not a code
// change (mirrors threads.ts's THREADS_DEFAULTS). `proxyUrl` is an optional
// residential-proxy offload hook — see resolve().
export interface InstagramConfig {
    docId: string;
    appId: string;
    friendlyName: string;
    proxyUrl?: string;
    // Optional logged-in session cookie (a burner's `sessionid=...`, ideally with
    // `csrftoken`/`ds_user_id`). When set, the GraphQL call authenticates and walks
    // past the login wall. SECURITY: this is a full account credential — it is only
    // sent on the metadata request, is never logged, and never enters the /v/ proxy
    // token (media replays on its own signed URL). Burners get banned; expect churn.
    cookie?: string;
    // Opt-in last-resort fallback: when our own fetch is login-walled, resolve via
    // snapsave.app (third-party, fragile — see snapsave.ts). Off by default.
    snapsave?: boolean;
}

export const INSTAGRAM_DEFAULTS: InstagramConfig = {
    docId: '25531498899829322',
    appId: '936619743392459',
    friendlyName: 'PolarisPostActionLoadPostQueryQuery',
};
