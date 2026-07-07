# fixem.be

**fixem.be** fixes broken social-media link previews. Many platforms serve
crawlers a bare page with no useful Open Graph tags, so links posted to Discord,
Telegram, Slack and friends show up without an image, title, or video. Prepend
`https://fixem.be/` to a link and the service returns rich embed metadata to the
crawler while sending real humans straight through to the original page.

```
https://fixem.be/https://www.reddit.com/r/pics/comments/abc123/example/
```

A crawler that fetches that URL gets a small HTML document full of Open Graph /
Twitter Card tags (title, description, image, video, author, oEmbed discovery
link). A person who clicks it gets a `302` redirect to the canonical original
URL. Same link, two audiences, correct behaviour for each.

---

## How it works

Every request for a wrapped URL flows through one catch-all route. The branch it
takes depends on the caller's `User-Agent` and an optional debug flag:

```
GET /https://example.com/hello
        │
        ├─ Parse & normalise the wrapped target URL
        │     (fails → 400 with a usage hint)
        │
        ├─ Is the User-Agent a known crawler?
        │     (discordbot, telegrambot, slackbot, twitterbot,
        │      facebookexternalhit, whatsapp, + EXTRA_CRAWLER_UAS)
        │
        ├── NO  ── rate-limit this client IP (crawlers are exempt)
        │            │
        │            ├─ ?fixem=preview present?
        │            │     YES → fall through and render the embed HTML
        │            │            (so you can inspect exactly what a crawler sees)
        │            │     NO  → 302 redirect to the canonical original URL
        │
        └── YES ── resolve metadata, render embed HTML
                     │
                     ├─ cache hit?  → serve cached metadata
                     ├─ cache miss? → run the platform adapter (with a timeout
                     │                 and a per-platform circuit breaker),
                     │                 then cache the result
                     └─ adapter/resolve failure? → degrade: minimal embed or a
                                                    plain 302, never a 500
```

The core invariant is that a well-formed wrapped URL never produces a `500`. If
an adapter throws, times out, or trips its circuit breaker, the request degrades
to a minimal embed or a redirect. If Redis is down, resolution simply runs
cache-less. See `src/app.ts` and `src/resolver.ts` for the exact logic.

Other routes:

- `GET /` — landing page (`public/index.html`) explaining usage.
- `GET /healthz` — liveness probe, returns `{"ok":true,"redis":<bool>}`.
- `GET /oembed?url=<canonical>` — oEmbed JSON endpoint referenced by the embed
  HTML's discovery link.

---

## Quick start

Requires [Bun](https://bun.sh) (v1+). A local Redis/Valkey is optional — without
it the service runs cache-less and with rate limiting disabled (see
[Configuration](#configuration)).

```bash
bun install          # install dependencies (hono only, at runtime)
bun run dev          # start on http://localhost:3000 with --watch
bun test             # run the full test suite
```

Then try it in a browser or with curl:

```bash
# See exactly what a crawler would receive:
curl 'http://localhost:3000/https://example.com/hello?fixem=preview'

# Health check:
curl http://localhost:3000/healthz
```

The bundled **dummy adapter** matches `example.com`, so
`http://localhost:3000/https://example.com/hello?fixem=preview` returns a working
"fixem.be works! 🎉" embed with no external dependencies — handy for smoke-testing
the whole crawler → resolve → cache → render pipeline.

---

## Docker

A `Dockerfile` and `compose.yaml` are included. Compose runs the app together
with a Valkey (Redis-compatible) cache:

```bash
docker compose up -d --build
```

The app is published on `127.0.0.1:3000` (loopback only — put a reverse proxy in
front for public traffic; see [Deployment](#deployment)). Compose wires
`REDIS_URL` to the Valkey service automatically, so `GET /healthz` should report
`{"ok":true,"redis":true}`. Any variables from a local `.env` file are loaded if
present (it is optional).

```bash
docker compose down          # stop
docker compose logs -f app   # tail app logs
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and edit as needed; every value has a sane default (see `src/lib/config.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | TCP port the HTTP server listens on. |
| `PUBLIC_BASE_URL` | `https://fixem.be` | Externally reachable base URL. Used to build the oEmbed discovery link and provider URLs embedded in responses; set it to your real public origin. |
| `REDIS_URL` | `redis://localhost:6379` | Redis/Valkey connection URL. Backs both the metadata cache and the rate-limit store. |
| `CACHE_TTL_SECONDS` | `14400` | How long resolved metadata stays cached (default 4 hours). |
| `RESOLVE_TIMEOUT_MS` | `5000` | Per-adapter resolve timeout. A slower upstream degrades to a minimal embed rather than hanging. |
| `RATE_LIMIT_PER_MIN` | `60` | Max requests per client IP per minute for non-crawler traffic. Crawlers are exempt. |
| `EXTRA_CRAWLER_UAS` | *(empty)* | Comma-separated extra `User-Agent` substrings (case-insensitive) to treat as crawlers, in addition to the built-in list. |
| `TWITCH_CLIENT_ID` | *(empty)* | Twitch app client ID. Required to enable Twitch clip embeds; register an app at [dev.twitch.tv/console](https://dev.twitch.tv/console). The adapter is disabled unless BOTH are set (logged on startup); when disabled, Twitch links fall through. |
| `TWITCH_CLIENT_SECRET` | *(empty)* | Twitch app client secret (pairs with `TWITCH_CLIENT_ID`). |
| `TWITCH_GQL_CLIENT_ID` | *(pinned)* | Twitch's public web client ID, used for the clip video (GraphQL) call. Override **only** if Twitch rotates its public web constants; the pinned default lives in `src/adapters/twitch.ts`. |
| `TWITCH_GQL_CLIP_HASH` | *(pinned)* | Persisted-query hash for the clip playback-access-token GraphQL call. Override **only** if Twitch rotates its public web constants. |
| `TWITTER_SYNDICATION_FEATURES` | *(pinned)* | Semicolon-joined feature flags sent to the X/Twitter syndication endpoint. Override **only** if X changes the flags it requires; the pinned default lives in `src/adapters/twitter.ts`. |
| `REDDIT_CLIENT_ID` | *(empty)* | Reddit app client ID (optional). When set together with the secret, the Reddit adapter authenticates via OAuth (`oauth.reddit.com`) instead of anonymous JSON, which many networks IP-block. Register a "script" app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps). |
| `REDDIT_CLIENT_SECRET` | *(empty)* | Reddit app client secret (optional, pairs with `REDDIT_CLIENT_ID`). |
| `PROXY_SECRET` | *(empty)* | HMAC key that signs `/v/` media-proxy URLs. **Set it to a random string to enable inline video** for TikTok/Threads/Instagram; blank disables the proxy and those platforms degrade to a thumbnail or link. See [Video proxy](#video-proxy). |
| `PROXY_HOST_ALLOWLIST` | *(pinned)* | Comma-separated CDN hosts the proxy may fetch (suffix match). The proxy is **not** an open proxy — only allowlisted hosts are reachable even with a valid token. Blank uses the built-in default list in `src/lib/config.ts`. |
| `PROXY_MAX_CONCURRENT` | `32` | Max simultaneous in-flight proxied streams (back-pressure guardrail). |
| `PROXY_MAX_BYTES` | `104857600` | Max bytes streamed per proxied response (100 MiB); a hostile/huge upstream is cut off. |
| `PROXY_TIMEOUT_MS` | `10000` | Upstream fetch timeout for the media proxy. |
| `THREADS_LSD` / `THREADS_DOC_ID` / `THREADS_APP_ID` / `THREADS_FRIENDLY_NAME` | *(pinned)* | Threads public web-client constants. Override **only** if Meta rotates them; the pinned defaults live in `src/adapters/threads.ts`. |
| `TIKTOK_MOBILE_API_HOST` / `TIKTOK_IID` / `TIKTOK_DEVICE_ID` | *(pinned)* | TikTok public web-client constants. Override **only** if TikTok rotates them; the pinned defaults live in `src/adapters/tiktok.ts`. |
| `INSTAGRAM_DOC_ID` / `INSTAGRAM_APP_ID` / `INSTAGRAM_FRIENDLY_NAME` | *(pinned)* | Instagram public web-client constants. Override **only** if Meta rotates them; the pinned defaults live in `src/adapters/instagram.ts`. |
| `INSTAGRAM_PROXY_URL` | *(empty)* | Optional residential-proxy offload prefix. Instagram is usually blocked from datacenter IPs; the target URL is appended (URL-encoded) to this prefix. Blank = direct fetch (which typically hits a login wall from a datacenter). |

### Redis outages degrade gracefully

Redis is a performance and abuse-control layer, not a hard dependency. Every
Redis operation is best-effort and fails open:

- **Cache outage** → metadata is resolved fresh on every request (cache-less
  resolution). Requests still succeed, just without the cache speedup and with
  more load on upstream platforms.
- **Rate-limit outage** → rate limiting is disabled (fail-open); requests are
  never blocked because the limiter cannot reach Redis.

Because the Redis connection is established lazily and does not block startup,
the **first requests after startup may be uncached** until the connection comes
up. `GET /healthz` reports the live connection state in its `redis` field.

---

## Adding an adapter

Each platform is a `PlatformAdapter` (see `src/adapters/types.ts`):

```ts
export interface PlatformAdapter {
  name: string;                       // e.g. "reddit"
  match(url: URL): boolean;           // does this adapter handle the URL?
  canonicalize(url: URL): string;     // stable cache key / canonical URL
  resolve(url: URL): Promise<EmbedMetadata>;  // fetch + parse metadata
}
```

To add one:

1. **Implement the adapter** in `src/adapters/<name>.ts`. Export a factory (e.g.
   `createFooAdapter(fetchFn?: FetchFn): PlatformAdapter`) that takes an
   **injected `fetchFn`** defaulting to the global `fetch`. Injecting `fetch`
   is what makes the adapter testable against recorded fixtures. Return an
   `EmbedMetadata` object from `resolve`; throw on non-2xx or unparseable
   responses so the resolver can degrade cleanly.
2. **Record a trimmed fixture** into `tests/fixtures/<name>/`. Capture a real
   upstream response, then trim it down to only the fields your parser reads
   (plus a little realistic noise). Keep fixtures small and committed.
3. **Test against the fixtures** in `tests/<name>.test.ts` by passing a stub
   `fetchFn` that returns the fixture bodies. Assert the resulting
   `EmbedMetadata` (kind, title, image/video, author, canonical URL, nsfw, …).
   No network access in tests.
4. **Register it** in `src/index.ts` by adding the factory to the
   `AdapterRegistry` list, e.g.
   `new AdapterRegistry([createDummyAdapter(), createFooAdapter()])`.
   The registry picks the first adapter whose `match()` returns `true`.

The `dummy` adapter (`src/adapters/dummy.ts`) is a minimal, network-free
reference implementation.

---

## Deployment

Run the container (or `bun src/index.ts`) behind a reverse proxy that terminates
TLS and forwards to the app on `127.0.0.1:3000`. Compose already binds the app to
loopback for exactly this topology.

Compose caps Valkey at 256 MB with `allkeys-lru` eviction, because cache keys
derive from attacker-influenceable URLs and must not grow unbounded.

**Forward client IPs.** Rate limiting keys the client IP off, in order:
`CF-Connecting-IP` → the **first** entry of `X-Forwarded-For` → the literal
`"unknown"`. If the service is deployed **without** a proxy that sets one of
these headers, every client collapses into a single `"unknown"` bucket and they
all share one rate-limit allowance. The reverse proxy **must** forward the real
client IP (set `X-Forwarded-For`, or `CF-Connecting-IP` on Cloudflare).

**Forward `User-Agent` untouched.** Crawler routing is driven entirely by
`User-Agent`. If your proxy rewrites or strips it, crawlers get treated as
browsers and receive redirects instead of embeds.

**Behind Cloudflare (orange-cloud):** disable **Rocket Loader** and **HTML
minification** for the embed paths — they mutate the tiny meta-only HTML document
and can break the tags crawlers parse. Leave `User-Agent` pass-through on.

---

## Supported platforms

| Platform | Status | Coverage |
|---|---|---|
| `example.com` (dummy adapter) | Available now (M1) | Smoke-test target |
| Reddit | Available now (M2) | Posts, galleries, video, crossposts, NSFW marker. Without `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, Reddit may degrade to plain redirects depending on the server's IP reputation. |
| Bluesky | Available now (M2) | Images, video thumbnail, quotes, external links |
| Twitch | Available now (M3) | Clips — title, broadcaster, view count, thumbnail, and inline MP4 (needs `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`). |
| Twitter/X | Available now (M3) | Tweets — text, photos, inline MP4 video, quoted-tweet preview, NSFW marker. No credentials required. |
| TikTok | Available now (M4) | Videos and photo posts — title, author, description, thumbnail, and inline video streamed through the `/v/` proxy (needs `PROXY_SECRET`). Short links (`vm.`/`vt.tiktok.com`) resolve. No credentials required. |
| Threads | Available now (M4) | Posts — text, images, carousels, and inline video streamed through the `/v/` proxy (needs `PROXY_SECRET`). No credentials required. |
| Instagram | Available now (M4) | Posts, reels, and carousels **when reachable**. Instagram is often blocked from datacenter IPs and returns a login wall — in that case the embed **degrades to an explanatory link** (by design, not a failure). Set `INSTAGRAM_PROXY_URL` to a residential offload to improve reliability. Inline video needs `PROXY_SECRET`. No credentials required. |

The dummy `example.com` adapter ships in M1 so the full pipeline can be verified
end-to-end (including against real Discord) without any platform dependency.
Reddit and Bluesky adapters land in M2, Twitch and Twitter/X in M3, and Threads,
Instagram, and TikTok in M4 (alongside the `/v/` video proxy).

Bluesky video currently embeds as a **thumbnail** rather than an inline player:
Bluesky serves video as HLS (`.m3u8`), which Discord's `og:video` player won't
fetch — the `/v/` proxy streams progressive MP4, not HLS.

**Twitch** requires a Twitch app (`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`,
registered at [dev.twitch.tv/console](https://dev.twitch.tv/console)); without
them the adapter is disabled at startup and Twitch links fall through. Clip video
is served through a short-lived **signed CDN URL**, so a resolved clip is cached
for only ~30 minutes rather than the default 4 hours — the signed URL is
short-lived, so embeds are re-fetched rather than cached long.

**Twitter/X** needs no credentials — it reads the anonymous syndication API. As a
limitation of that anonymous path, NSFW / age-restricted posts (and deleted or
withheld ones) can't return media and degrade to a plain text notice instead of a
full embed.

---

## Video proxy

TikTok, Threads, and Instagram serve their video from CDN URLs that are
short-lived and locked to the requesting IP/UA — Discord's `og:video` player
can't fetch them directly. fixem.be solves this with a signed media proxy at
`/v/`: at render time the raw CDN URL is replaced with an HMAC-signed
`/v/<token>` URL, and `/v/` streams the bytes back (with `Range` support so the
player can seek), attaching the per-platform headers the CDN requires.

**Enabling it.** Set `PROXY_SECRET` to a random string (e.g.
`openssl rand -hex 32`). With it unset, the proxy is off and video degrades to a
thumbnail or link (a startup log line warns about this). The raw CDN URL is
**never** exposed in an embed — only the signed `/v/` URL is.

**It is not an open proxy.** Tokens are HMAC-signed by the server and every
target is checked against `PROXY_HOST_ALLOWLIST` (suffix match), so even a forged
or replayed token can only ever reach an allowlisted CDN host. `PROXY_MAX_BYTES`
and `PROXY_MAX_CONCURRENT` cap bandwidth and in-flight streams.

**CRITICAL deployment requirement — do NOT proxy `/v/` through Cloudflare's
orange cloud.** Cloudflare's Terms of Service §2.8 forbid using the CDN to serve
a disproportionate amount of non-HTML content (video). Put `/v/` — or a
dedicated `v.fixem.be` — on a **DNS-only "grey-cloud"** record so video bytes
flow straight to your origin and bypass Cloudflare entirely. Keep the HTML embed
paths on the orange cloud if you like, but the media stream must not be.

---

## Verifying in Discord

```
1. Deploy (or tunnel a local instance: `cloudflared tunnel --url http://localhost:3000`).
2. In any Discord channel, post: https://<your-host>/https://example.com/hello
3. You should see a "fixem.be works! 🎉" embed with image and author line.
4. Append `?fixem=preview` in a browser to inspect the exact HTML Discord saw.
5. If no embed appears: check that the reverse proxy forwards User-Agent,
   and retry with a fresh path (Discord caches embeds per-URL aggressively —
   change /hello to /hello2 to bust it).
```
