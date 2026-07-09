# Changelog

## [2.0.0](https://github.com///compare/v1.3.2...v2.0.0) (2026-07-09)

### ⚠ BREAKING CHANGES

* **api:** switch /api auth to Authorization: Bearer against API_KEYS

### Features

* **api:** add /api/v1 resolve/canonical/platforms/health; retire /api/status/adapter ([0c4734b](https://github.com///commit/0c4734b5dc8bbde068847cc48524b8b4afe3dfb5))
* **api:** add PublicMetaRenderer (proxyHeaders-stripping public JSON mapper) ([c6223db](https://github.com///commit/c6223db0c654aed04ea5abccc9470123ab93fcd9))
* **api:** add Secrets.hash and key-bucketed ApiRateLimitMiddleware ([7f35da3](https://github.com///commit/7f35da38b5703e863de77d2727ea6ff49366d753))
* **api:** add static platform capability table for /api/v1/platforms ([5e9edec](https://github.com///commit/5e9edec9afaa63493dbe121c87e17a8259727a77))
* **api:** ship openapi.yaml, serve it publicly, guard route drift ([b7e948a](https://github.com///commit/b7e948ab552756b844d57b4f0ec13d73156f1654))
* **api:** switch /api auth to Authorization: Bearer against API_KEYS ([f4b3e0f](https://github.com///commit/f4b3e0f14224b7ba0a22fb1cdead1fdc9726cee6))
* **config:** add API_KEYS, API_RATE_LIMIT_PER_MIN, BATCH_MAX_URLS ([0ea3025](https://github.com///commit/0ea3025dba8344fe4e4117f789206f8e5a1c2ee7))

### Bug Fixes

* **api:** quote openapi.yaml descriptions with braces; validate YAML parses in the drift-guard test ([6f47e32](https://github.com///commit/6f47e32965c7015f260d8c02df7ea8c06ffa36c4))
* Cache-warm platform capability list; wrap long lines to match Prettier config ([158e4b4](https://github.com///commit/158e4b4391a186d1de1a81243ef7e7e774239831))

## [1.3.2](https://github.com///compare/v1.3.1...v1.3.2) (2026-07-08)

## [1.3.1](https://github.com///compare/v1.3.0...v1.3.1) (2026-07-08)

### Bug Fixes

* copy tsconfig.json into Docker image so Bun resolves @/ alias at runtime ([42c2417](https://github.com///commit/42c24172a0f346b70934e44450e9905ab9ada5e5))

## [1.3.0](https://github.com///compare/v1.2.0...v1.3.0) (2026-07-08)

### Features

* add BaseAdapter with shared linkCard helper ([19a22d8](https://github.com///commit/19a22d812f453cb940d1f8149a9b16b141caed69))
* add EmbedController for catch-all embed/redirect/preview ([b09cb7a](https://github.com///commit/b09cb7a4b41c1d03ce00e0cc8ef28c9dd6335a1f))
* add health/oembed/status/proxy controllers ([5ffd80f](https://github.com///commit/5ffd80f2229530c9d38e34595a0904dc45c6766d))
* add http middleware classes ([3aaed5a](https://github.com///commit/3aaed5af678ab67ebf9afcd7f40ce9da98ef30b3))
* add HttpClient absorbing shared UA + fetch helpers ([293f4ad](https://github.com///commit/293f4ad4f348519b715696551e7f31b2b1240aed))
* add injectable Clock service ([c02093c](https://github.com///commit/c02093cda1f0a6c2a8b590722818faf4c1f0cf86))
* add LandingPage service ([3348d0c](https://github.com///commit/3348d0c750c1c0504cd4babdc56a5b1612d149d0))
* extract VideoProxy from app route closure ([0d3d4cf](https://github.com///commit/0d3d4cfa038ebfcba3df6a882cff59abbdad82ca))
* wire container via bootstrap + routes, migrate integration tests to createTestApp ([a503bc8](https://github.com///commit/a503bc8e1b07df9c595e06262f87fe9e05e14137))

## [1.2.0](https://github.com///compare/v1.1.0...v1.2.0) (2026-07-08)

### Features

* put status endpoint behind authenticated /api/* ([c73bede](https://github.com///commit/c73bedeb60a37274640382cad946cd04c704a4f3))

### Bug Fixes

* check adapters via JSON /status/adapter, not /preview/ HTML ([64c5d0e](https://github.com///commit/64c5d0e39a049b02e93089a6200b053780852e34))

## [1.1.0](https://github.com///compare/v1.0.5...v1.1.0) (2026-07-08)

### Features

* add Gatus status monitoring to prod stack ([c870c8d](https://github.com///commit/c870c8dd85faad450fa2c43766bc005ab2672de7))

## [1.0.5](https://github.com///compare/v1.0.4...v1.0.5) (2026-07-08)

## [1.0.4](https://github.com///compare/v1.0.3...v1.0.4) (2026-07-08)

## [1.0.3](https://github.com///compare/v1.0.2...v1.0.3) (2026-07-08)

## [1.0.2](https://github.com///compare/v1.0.1...v1.0.2) (2026-07-08)

## [1.0.1](https://github.com///compare/v1.0.0...v1.0.1) (2026-07-08)

## 1.0.0 (2026-07-08)

### Features

* adapter interface, registry, dummy adapter ([4c3bb6b](https://github.com///commit/4c3bb6b1f595a03d1cdd988ae59f32dd123f0832))
* Bluesky adapter (images, video thumbnail, quotes, external) ([fc5c98b](https://github.com///commit/fc5c98bca6c1b7e7a451ddda93b7441c66a7dab8))
* crawler user-agent detection ([84ffdbd](https://github.com///commit/84ffdbd4932c3c1ec11c6bd52fca18bd733e0d31))
* Docker deployment, env example, README (completes M1) ([76aff93](https://github.com///commit/76aff93359131b58b5cd6fa0230f98ce165b97a2))
* env-based config loader with defaults ([f0b53d0](https://github.com///commit/f0b53d0dd5f2d8e82f32039e7d2834e828e065a8))
* env-override Twitter syndication features string ([d543f13](https://github.com///commit/d543f1328243c902bc391387a112f5b346f5bdf8))
* forward TikTok page-scrape session cookies to the /v/ proxy ([0cd6fb7](https://github.com///commit/0cd6fb7464206dde8ea147364d613287fdec422a))
* HMAC-signed proxy token + video.proxyHeaders hint ([acbbdae](https://github.com///commit/acbbdae6166d6cc3758bd2c36a37d960876780a8))
* Instagram adapter with login-wall degrade ([4d4fa1b](https://github.com///commit/4d4fa1ba9a59f2770d0bd930525594892bd555ce))
* Instagram authenticated mobile media/info path (cookie); reliable vs rotating web doc_id ([01ddef5](https://github.com///commit/01ddef51c3ce4558a41c81593501e11eeed03214))
* landing page and server entrypoint ([89dd287](https://github.com///commit/89dd287e2aae648f491fbc617625efee868fa887))
* metadata cache with memory and best-effort Redis backends ([343266d](https://github.com///commit/343266df1740bc0626d4a64b923ca1b69e77ce19))
* minimal structured JSON logger ([a43f89e](https://github.com///commit/a43f89ea3079e7561f07abdec5b2a0eb48b7332e))
* move diagnostic preview from ?fixem=preview to /preview/<url> ([1ba93c3](https://github.com///commit/1ba93c3aeec9c52f60ebbe352128df823b8528e5))
* oEmbed JSON renderer ([7a11e94](https://github.com///commit/7a11e947f50d16f84aa16a091dde06d38d62275c))
* OpenGraph/Twitter Card meta-HTML renderer ([da012e0](https://github.com///commit/da012e015c2f27660e5541cdf552b70932debfe3))
* opt-in snapsave.app fallback for Instagram (safe pure decoder, fixture-tested) ([0f03f20](https://github.com///commit/0f03f20cf2f3ad3c3193dcd3937548e8e35b54ba))
* optional Instagram session-cookie auth (burner) to bypass login wall ([5ffd6d9](https://github.com///commit/5ffd6d97e290eed06422cf087b244034d293c9b3))
* optional proxy offloads for anonymous reddit fetches ([6380939](https://github.com///commit/6380939a0d5eaa606d0607aa997118866da68bed))
* optional Reddit OAuth for IP-blocked anonymous access ([6d918e0](https://github.com///commit/6d918e001be1448e47235d316a488010944b6703))
* per-result cache TTL hint for expiring media URLs ([785fb0a](https://github.com///commit/785fb0adcfda0cd2b0904048d57795e14d6a3993))
* Reddit adapter (posts, video, gallery, crosspost, nsfw) ([0ccfeaa](https://github.com///commit/0ccfeaad280a882769acbb733c4de0fff89c11ab))
* Reddit anonymous old.reddit HTML fallback (self-serve .json API is dead) ([0fed6ad](https://github.com///commit/0fed6adbeeb66589f0399ba8a92ee126079334a3))
* register Reddit and Bluesky adapters (completes M2 code) ([aca98a6](https://github.com///commit/aca98a6aad75dd1fd8de219c97599c08e4d6e890))
* register Threads/TikTok/Instagram + video proxy config (completes M4) ([ca176ae](https://github.com///commit/ca176ae9e3cd3042ac9d04c73f00e34d832c977e))
* register Twitch and Twitter adapters (completes M3 code) ([ef39d4f](https://github.com///commit/ef39d4fd0a784626f3ea715c1b1b27cbaf0f5441))
* resolve Reddit share links and map Bluesky content labels ([95c9088](https://github.com///commit/95c908849b1a6f83214fd14593ff81e71a381425))
* resolver with cache, in-flight dedup, timeout, circuit breaker ([d6dfd9d](https://github.com///commit/d6dfd9d6d6f937e2f3efe2621945145c110e9ba4))
* rewrite proxied video URLs through /v/ at render time ([88bccf7](https://github.com///commit/88bccf73bfb22bb4d19935e989af19beb0bfb9c9))
* rich ?fixem=preview diagnostic report for matched URLs ([65e4203](https://github.com///commit/65e4203084c1bc78b0c16889c0ff1ace4eb6a963))
* route assembly with UA branching, rate limiting, failure degradation ([5665e38](https://github.com///commit/5665e3860d73b50e4d3957c84a05e058084187ba))
* show a diagnostic page for ?fixem=preview on no-adapter URLs ([28a0d18](https://github.com///commit/28a0d18cf194be840227d08ecb980a685ad709e6))
* signed streaming video proxy route /v/ ([d9c377a](https://github.com///commit/d9c377a87373865ce4945f6fb029a763f09e828a))
* sliding-window rate limiting with memory and Redis stores ([8b68473](https://github.com///commit/8b684734befb817577f7d76343c31bbc2d47dde3))
* target URL parsing with encoding and scheme guards ([cb31785](https://github.com///commit/cb3178527ffe22ba276ed502d4f4398da61c5812))
* Threads adapter (anonymous GraphQL) ([90ce217](https://github.com///commit/90ce217eb20a2b6f4c8efaf0e865fabda4fd460f))
* TikTok adapter (web rehydration scrape + proxied playback) ([a974857](https://github.com///commit/a974857491ad95028541997213d80ed41a403fd3))
* Twitch Clips adapter (Helix metadata + GQL signed MP4) ([5d71c73](https://github.com///commit/5d71c7389ffa5b42352e479e508e8dc5dc405b1d))
* Twitter/X adapter via syndication CDN ([10d1925](https://github.com///commit/10d19256f8a8058584373ad00ad6f10da143ebaf))
* word-boundary truncate helper ([c314362](https://github.com///commit/c31436265abe062f3ef8c0484ef2830cc284523c))

### Bug Fixes

* /v/ re-validates each redirect hop against allowlist (SSRF hardening) ([d570490](https://github.com///commit/d5704901e7d890f4b2c21ab086c9823ae42a9090))
* blank env values fall back to pinned Twitch GQL defaults ([1cb0212](https://github.com///commit/1cb021222ad47f6d99e9c970567f0242189d4e11))
* crosspost inherits parent media past regenerated child preview ([065187e](https://github.com///commit/065187e1aa7bca1ea51e33919046cf901dbc8263))
* fail open immediately on Redis outage (disable offline queue) ([9684b72](https://github.com///commit/9684b72030d2ca17119d5518e086610a8643d673))
* fragment-safe query re-attachment in target URL parsing ([53d0fcb](https://github.com///commit/53d0fcba868cce2484c152db68df1209465ee8df))
* guard truncate against non-positive max ([91c1361](https://github.com///commit/91c136152f23678ad0d180ce72233307a2f9a949))
* harden proxy streaming, snapsave decoder, and per-resolve cancellation ([cb2eae8](https://github.com///commit/cb2eae8ef790a4afe02065b1584c31d5cd3fb5de)), closes [notFoundPost/#blockedPost](https://github.com/notFoundPost//issues/blockedPost)
* label preview requests accurately in embed log ([6d978e8](https://github.com///commit/6d978e8369a58ffba24b478024b3b87c6cf63a1d))
* M3 adapter robustness (tombstone nsfw, encoding, twitch path + embed form) ([260e23d](https://github.com///commit/260e23d1f786fbc3197f2852cf2491df09084559))
* M4 video-proxy hardening (byte ceiling, https-only, rate limit, XDT typenames, EU CDNs, mint-time allowlist) ([375e28a](https://github.com///commit/375e28a0b109a697974f540815c97fb1388b652b))
* preview inspectability, redirect logging, compose memory cap, landing link ([1ba40cb](https://github.com///commit/1ba40cb3b56eb971dfc1b397b6a07aebd81bc791))
* rate-limit /oembed and harden config floors ([ceb2ef8](https://github.com///commit/ceb2ef8e0b00fa3fb9ebe11dc2c4a4fda7b923e6))
* rate-limit preview hatch, no-store degraded embeds, query-safe onError ([f1a303d](https://github.com///commit/f1a303d7b2d1b43efe48426811c9408fd940b14a))
* Reddit share links use OAuth when configured ([69c17c8](https://github.com///commit/69c17c802838af4424ca72e9952770d6e228205c))
* **reddit:** use first i.redd.it gallery original instead of broken og:image; adopt Montserrat/DM Sans on landing and preview pages ([e8e6d69](https://github.com///commit/e8e6d692ecec1ecb79079adab4b1fe32e65b4cc9))
* require boundary after tweet ID in path match ([81aef9a](https://github.com///commit/81aef9aa1c67891b50e72d8025ccb533c1ecec0d))
* self-contained never-throw guard in resolver ([1710823](https://github.com///commit/171082361c6f22b00752ead6e85fb70c025505f5))
* serve cache hits while circuit breaker is open ([9b8e410](https://github.com///commit/9b8e41044ce4cbc9caf77b3cc89cc1beda3ae9ca))
* shared platform User-Agent constant ([0936fd9](https://github.com///commit/0936fd9142db8c6447e6508a3d7cbb9ce85143c3))
* Threads degrades to informative card on Meta HTML bot-block; refresh doc_id ([297c38e](https://github.com///commit/297c38e49774cb01ef7193e3ab1dd452e0b170d1))
* Threads raw route-body wire format + carousel count with cover ([2d29be2](https://github.com///commit/2d29be2831743b7abcbe1349bc30d11f575f83f7))
* title accounts without display name as [@handle](https://github.com/handle) ([b9ef89f](https://github.com///commit/b9ef89fa53dd0c002d150d38fa6ed3463eb51303))

All notable changes to this project are documented in this file. It is
maintained automatically by [release-it](https://github.com/release-it/release-it)
from [Conventional Commits](https://www.conventionalcommits.org/).
