# fixem.be

[![CI](https://github.com/rickklaasboer/fixem.be/actions/workflows/ci.yml/badge.svg)](https://github.com/rickklaasboer/fixem.be/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/rickklaasboer/fixem.be?sort=semver&label=release)](https://github.com/rickklaasboer/fixem.be/releases)
[![Container image](https://img.shields.io/badge/ghcr.io-fixem.be-2496ED?logo=docker&logoColor=white)](https://github.com/rickklaasboer/fixem.be/pkgs/container/fixem.be)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-14151A?logo=bun&logoColor=white)](https://bun.sh)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Donate](https://img.shields.io/badge/donate-PayPal-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/rickklaasboer)

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
        │            ├─ /preview/ path prefix present?
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
curl 'http://localhost:3000/preview/https://example.com/hello'

# Health check:
curl http://localhost:3000/healthz
```

The bundled **dummy adapter** matches `example.com`, so
`http://localhost:3000/preview/https://example.com/hello` returns a working
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

### Deploying the published image

`compose.yaml` builds locally (for development). For deployment, use
`compose.prod.yaml`, which pulls the prebuilt image from GHCR
(`ghcr.io/rickklaasboer/fixem.be`) instead of building:

```bash
docker compose -f compose.prod.yaml pull     # fetch the newest image
docker compose -f compose.prod.yaml up -d     # (re)start
```

It defaults to the `latest` tag; pin a release with `FIXEM_TAG`:

```bash
FIXEM_TAG=1.0.0 docker compose -f compose.prod.yaml up -d
```

Put real config in a `.env` file next to the compose file (see
[Configuration](#configuration)). Images are published automatically on every
merge to `main` (see the CI pipeline in `.github/workflows/`).

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and edit as needed; every value has a sane default (see `src/lib/config.ts`), so
an empty `.env` still runs a working — if platform-limited — service.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | TCP port the HTTP server listens on. |
| `PUBLIC_BASE_URL` | `https://fixem.be` | Externally reachable base URL, used to build the oEmbed discovery link and provider URLs in responses. Set it to your real public origin. |
| `REDIS_URL` | `redis://localhost:6379` | Redis/Valkey connection URL. Backs both the metadata cache and the rate-limit store. |
| `CACHE_TTL_SECONDS` | `14400` | How long resolved metadata stays cached (default 4 hours). |
| `RESOLVE_TIMEOUT_MS` | `5000` | Per-adapter resolve timeout. A slow upstream degrades to a minimal embed rather than hanging. |
| `RATE_LIMIT_PER_MIN` | `60` | Max requests per client IP per minute for non-crawler traffic. Crawlers are exempt. |
| `EXTRA_CRAWLER_UAS` | *(empty)* | Comma-separated extra `User-Agent` substrings (case-insensitive) to treat as crawlers, on top of the built-in list. |
| `PROXY_SECRET` | *(empty)* | HMAC key that signs `/v/` media-proxy URLs. **Set it to a random string to enable inline video** for TikTok/Threads/Instagram; blank disables the proxy and those platforms degrade to a thumbnail or link. See [Video proxy](#video-proxy). |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | *(empty)* | Twitch app credentials ([register an app](https://dev.twitch.tv/console)). Both are required to enable Twitch clips; without them the adapter is disabled at startup and Twitch links fall through. |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | *(empty)* | Optional Reddit OAuth credentials. Without them the adapter scrapes old.reddit.com HTML (video → poster image only); with them it uses the OAuth API for full data incl. muxed video. Self-serve keys are approval-gated since 2025. |
| `INSTAGRAM_PROXY_URL` | *(empty)* | Optional residential-proxy offload prefix; the target URL is appended (URL-encoded). Instagram is usually login-walled from datacenter IPs, so a direct fetch (blank) typically fails. |
| `INSTAGRAM_COOKIE` | *(empty)* | Optional logged-in session cookie (use a **burner** — IG bans scraping accounts) to get past the login wall. Minimum `sessionid=…` (add `csrftoken`/`ds_user_id` for fewer challenges). A full account credential: never logged, never placed in `/v/` tokens, gitignored. Expect an expiry/ban rotation treadmill. |
| `INSTAGRAM_SNAPSAVE` | `false` | Opt-in last-resort fallback (`"true"` to enable): when our own fetch is login-walled, resolve via snapsave.app. Best-effort and **fragile** — it leans on third-party services and may break without notice. |

<details>
<summary><strong>Advanced &amp; version-pinned variables</strong> — proxy tuning and platform web-client constants you shouldn't normally need to touch</summary>

<br>

All of these ship with working pinned defaults. The platform constants only need
overriding if a platform rotates its public web-client values; each default
lives next to its adapter in `src/adapters/`.

| Variable | Default | Meaning |
|---|---|---|
| `PROXY_HOST_ALLOWLIST` | *(pinned)* | Comma-separated CDN hosts the proxy may fetch (suffix match). The proxy is **not** open — only allowlisted hosts are reachable even with a valid token. Blank uses the built-in list. |
| `PROXY_MAX_CONCURRENT` | `32` | Max simultaneous in-flight proxied streams (back-pressure guardrail). |
| `PROXY_MAX_BYTES` | `104857600` | Max bytes per proxied response (100 MiB); a hostile/huge upstream is cut off. |
| `PROXY_TIMEOUT_MS` | `10000` | Upstream fetch timeout for the media proxy. |
| `TWITCH_GQL_CLIENT_ID` / `TWITCH_GQL_CLIP_HASH` | *(pinned)* | Twitch's public web client ID and clip persisted-query hash, used for the clip video (GraphQL) call. |
| `TWITTER_SYNDICATION_FEATURES` | *(pinned)* | Semicolon-joined feature flags sent to the X/Twitter syndication endpoint. |
| `THREADS_LSD` / `THREADS_DOC_ID` / `THREADS_APP_ID` / `THREADS_FRIENDLY_NAME` | *(pinned)* | Threads public web-client constants. |
| `TIKTOK_MOBILE_API_HOST` / `TIKTOK_IID` / `TIKTOK_DEVICE_ID` | *(pinned)* | TikTok public web-client constants. |
| `INSTAGRAM_DOC_ID` / `INSTAGRAM_APP_ID` / `INSTAGRAM_FRIENDLY_NAME` | *(pinned)* | Instagram public web-client constants. |

</details>

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

## Status monitoring

`compose.prod.yaml` ships an optional [Gatus](https://github.com/TwiN/gatus)
sidecar (`gatus` service) that watches the deployment:

- **Liveness** (every minute): `GET /healthz` (app + Redis) and the full public
  path `https://fixem.be/healthz` (also checks the TLS cert isn't near expiry).
- **Adapters** (every 4 hours): one real resolve per platform through the
  `/preview/` hatch. The 4h interval matches `CACHE_TTL_SECONDS` so each run is a
  genuine upstream re-fetch rather than a cached re-validation. A check passes
  when the adapter still produces real media; if a platform changes and the embed
  degrades to a link, the check goes red. Threads is checked for a live code path
  only, since it degrades by design from a datacenter IP.

Set `GATUS_DISCORD_WEBHOOK_URL` in `.env` to get Discord alerts on
failure/recovery (blank = dashboard only). The dashboard binds to
`127.0.0.1:8080`; front it with your reverse proxy for a public status page
(e.g. `status.fixem.be` → `127.0.0.1:8080`).

The monitored URLs live in `gatus/config.yaml` — they're stable, high-profile
public posts. Because upstream posts can be deleted, verify each is green after
first deploy and swap any that aren't:

```bash
# On the VPS, from the compose directory — confirm each adapter returns media
# (or, for threads, a live code path) BEFORE relying on alerts:
for u in \
  "https://www.reddit.com/r/pics/comments/haucpf/ive_found_a_few_funny_memories_during_lockdown/" \
  "https://bsky.app/profile/bsky.app/post/3m5yqc2is5s2q" \
  "https://x.com/TheEllenShow/status/440322224407314432" \
  "https://www.instagram.com/p/BsOGulcndj-/" \
  "https://www.tiktok.com/@zachking/video/7095025543627705643" ; do
  printf '%s -> ' "$u"
  curl -s "http://127.0.0.1:3000/preview/$u" | grep -q 'class="media"' && echo OK || echo "NO MEDIA — swap"
done
```

**Twitch** is left commented out in `gatus/config.yaml`: clips get deleted or
expire, so there's no stable default. Drop in a clip URL from a big, always-active
channel and uncomment the block to monitor it.

---

## Supported platforms

| Platform | Coverage |
|---|---|
| `example.com` (dummy adapter) | Network-free smoke-test target for the full crawler → resolve → cache → render pipeline. |
| Reddit | Images, galleries, text, link previews, and NSFW via old.reddit.com HTML (**video posts show a poster image only**). With `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, the OAuth API adds muxed video and richer crosspost media. Reddit's anonymous `.json` API is dead and self-serve keys are approval-gated (2025 Responsible Builder Policy). |
| Bluesky | Images, video thumbnail, quotes, external links. No credentials required. |
| Twitch | Clips — title, broadcaster, view count, thumbnail, and inline MP4. Needs `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`; without them the adapter is disabled at startup and Twitch links fall through. |
| Twitter/X | Tweets — text, photos, inline MP4, quoted-tweet preview, NSFW marker. No credentials required. |
| TikTok | Videos and photo posts — title, author, description, thumbnail, and inline video via the `/v/` proxy (needs `PROXY_SECRET`). Short links (`vm.`/`vt.tiktok.com`) resolve. No credentials required. |
| Threads | Posts — text, images, carousels, and inline video via the `/v/` proxy (needs `PROXY_SECRET`). No credentials required. |
| Instagram | Posts, reels, and carousels **when reachable**. Often blocked from datacenter IPs behind a login wall — the embed then **degrades to an explanatory link** (by design). Set `INSTAGRAM_PROXY_URL` for a residential offload; inline video needs `PROXY_SECRET`. No credentials required. |

A few limitations worth knowing:

- **Bluesky video** embeds as a thumbnail, not an inline player: Bluesky serves
  HLS (`.m3u8`), which Discord's `og:video` player won't fetch, and the `/v/`
  proxy streams progressive MP4 rather than HLS.
- **Twitch clips** play from a short-lived signed CDN URL, so a resolved clip is
  cached for only ~30 minutes rather than the default 4 hours.
- **Twitter/X** reads the anonymous syndication API, so NSFW / age-restricted,
  deleted, or withheld posts can't return media and degrade to a plain text
  notice.

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
4. Prepend `/preview/` to the wrapped URL in a browser to inspect the exact HTML Discord saw.
5. If no embed appears: check that the reverse proxy forwards User-Agent,
   and retry with a fresh path (Discord caches embeds per-URL aggressively —
   change /hello to /hello2 to bust it).
```

---

## Support

fixem.be is free and self-hostable, and the public instance runs on a VPS I pay
for myself. If it fixed a broken embed for you and you'd like to help cover the
hosting bill, you can send a few euros my way:

[![Donate with PayPal](https://img.shields.io/badge/donate-PayPal-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/rickklaasboer)

It's entirely optional, and appreciated either way. Thanks.

---

## License

Licensed under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`) — see [`LICENSE`](LICENSE).

In short: you may use, modify, and self-host fixem.be freely, but if you run a
modified version as a network service, you must offer that service's users the
corresponding source (see section 13 of the license). The landing page links
back to this repository to satisfy that source-offer for the public instance.

© 2026 Rick Klaasboer
