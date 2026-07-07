# fixem.be — Design

**Date:** 2026-07-07
**Status:** Approved (Approach A: single app, layered core, adapter plugins)

## 1. Overview

fixem.be is a Discord embed-fixing service. Users prepend `https://fixem.be/` to a social media URL; the service serves rich, working embeds to link-preview crawlers (Discord first) and redirects real browsers to the original URL.

Supported platforms (build order): Reddit, Bluesky, Twitch Clips, Twitter/X, Threads, Instagram, TikTok.

**Stack:** Bun runtime, Hono (TypeScript strict), Redis/Valkey cache, Docker + docker-compose, deployed on a user-controlled VPS behind Cloudflare and a reverse proxy. No frontend framework, no database.

## 2. Routing & request flow

| Route | Purpose |
|---|---|
| `GET /` | Static landing page (single HTML file explaining usage) |
| `GET /healthz` | 200 + Redis ping status (for reverse proxy checks) |
| `GET /oembed?url=<canonical>` | oEmbed JSON: author name/url, provider "fixem.be" |
| `GET /v/:platform/:id` | Video proxy (M4; Range support; strategy decided at M4) |
| `GET /*` | Catch-all: path (+ query) is the target URL |

### Target URL parsing (catch-all)

1. Strip leading `/`; accept `https://…`, `http://…`, and bare `www.host/…` (default https).
2. Accept URL-encoded paths; decode once, reject *structurally* double-encoded input (scheme colon or slash still percent-encoded after one decode). Deeper double-encoding of ordinary characters passes through — it may be a legitimate literal %-sequence in the target URL — and any percent-sequence remaining in the hostname is either decoded to a valid domain code point by the WHATWG host parser or causes rejection: the final `url.hostname` is always the fully-decoded fetch target that adapter matching (stage 2) sees.
3. Validate scheme is http(s) and hostname matches a registered adapter **before any network fetch**. This doubles as the SSRF guard: only adapter-claimed hosts are ever fetched.
4. No adapter match → `302` to the URL if it is a valid public http(s) URL, else `400` with a short plain-text usage hint.

### User-agent branching

- **Crawler UAs** — `Discordbot`, `Telegrambot`, `Slackbot`, `Twitterbot`, `facebookexternalhit`, `WhatsApp`, plus a configurable extra list (env): serve meta-HTML with crawler-appropriate `Cache-Control`.
- **Everything else** (real browsers): immediate `302` to the canonicalized original URL. No metadata fetch on this path.
- Debug escape hatch: `?fixem=preview` serves the meta-HTML to a browser.

### Failure policy (global invariant)

Any error in resolution — adapter exception, per-resolve timeout (default 5 s), Redis down — degrades to: `302` for browsers; minimal embed (canonical URL as title) or redirect for crawlers. The catch-all never returns 500 for a well-formed URL. If one platform's adapter breaks, all others keep working.

## 3. Adapter interface & metadata model

```ts
interface PlatformAdapter {
  name: string;
  match(url: URL): boolean;
  canonicalize(url: URL): string; // strip tracking params, normalize
  resolve(url: URL): Promise<EmbedMetadata>;
}

interface EmbedMetadata {
  kind: 'video' | 'image' | 'gallery' | 'link';
  title: string;
  description?: string;
  author?: { name: string; url?: string };
  siteName: string;
  themeColor?: string;
  image?: { url: string; width?: number; height?: number };
  video?: { url: string; width?: number; height?: number; mimeType: string };
  nsfw?: boolean; // rendered as a 🔞 marker in the title
  originalUrl: string;
}
```

- Registry: ordered array of adapters; first `match()` wins.
- Adapters are pure "URL in → metadata out"; they know nothing about HTTP routing, caching, or rendering. All platform-specific hacks stay inside the adapter.
- Each adapter is independently testable with recorded fixtures.

### Platform notes (from spec)

1. **Reddit** — public JSON API (`.json` suffix). Posts, galleries, v.redd.it video (prefer muxed fallback MP4 over DASH), crossposts, NSFW flag.
2. **Bluesky** — `public.api.bsky.app`, `app.bsky.feed.getPostThread`. Images, video, quote posts, external embeds.
3. **Twitch Clips** — Helix API, client-credentials via env. Clip metadata + direct MP4.
4. **Twitter/X** — guest-token/syndication approaches (fxtwitter-style). Images, highest-bitrate MP4, quote tweets; threads = first tweet only for MVP.
5. **Threads** — embed/GraphQL endpoints used by existing fixers; shares infra with Instagram.
6. **Instagram** — posts, reels. Realistic headers, retries with backoff, graceful degradation to redirect on bot-detection.
7. **TikTok** — videos and photo posts; signed CDN URLs expire → may require the `/v/` proxy.

Before implementing Twitter/Instagram/TikTok, research how fxtwitter, ddinstagram, and vxtiktok solve them.

## 4. Resolver (cache, dedup, isolation)

- **Cache:** Redis, key `meta:<canonical URL>`, value = JSON `EmbedMetadata`, TTL 4 h (env-configurable).
- **In-flight dedup:** in-process `Map<string, Promise<EmbedMetadata>>` — sufficient for a single instance; multiple simultaneous Discord crawler hits share one resolve.
- **Timeout:** 5 s per `resolve()` (env-configurable).
- **Circuit-breaker-lite:** 5 consecutive failures for a platform → that platform degrades to instant redirect for 60 s, then retries. Prevents a broken scraper from slow-burning the service.
- **Redis unavailable:** resolver works cache-less (straight through to adapter) and logs a warning; health endpoint reports degraded.

## 5. Rendering

One renderer module consumes `EmbedMetadata` and produces:

- **Meta-HTML:** minimal page with OpenGraph + Twitter Card tags — `og:title`, `og:description`, `og:site_name`, `theme-color`, `og:image(:width/:height)`, and for video `og:video`, `og:video:type`, `og:video:width/height`, `twitter:card=player`, `twitter:player:*`. Includes `<link rel="alternate" type="application/json+oembed" href="https://fixem.be/oembed?url=<canonical>">`.
- **oEmbed JSON:** `type`, `author_name`, `author_url`, `provider_name: "fixem.be"`, `provider_url`. Served from the same Redis cache by canonical URL.
- NSFW: 🔞 prefix on the title; media still embedded (fxtwitter-style; Discord channel settings govern visibility).

## 6. Rate limiting

Redis-based sliding window on public routes: default 60 req/min per client IP (env-configurable). Known crawler UAs exempt. IPs are used only for rate limiting; logs carry truncated IPs.

## 7. Logging

Structured JSON logging (pino or Bun-native). Per request: platform, cache hit/miss, resolve latency, UA class (crawler/browser), outcome (embed/redirect/degraded). No full client IPs in logs.

## 8. Configuration

Env vars with `.env.example`: `REDIS_URL`, `CACHE_TTL_SECONDS`, `RESOLVE_TIMEOUT_MS`, `RATE_LIMIT_PER_MIN`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `EXTRA_CRAWLER_UAS`, `PORT`, `PUBLIC_BASE_URL`.

## 9. Deployment

- Multi-stage Dockerfile (Bun build → slim runtime image).
- docker-compose: app + Valkey (Redis-compatible), private network, app port exposed to host for the reverse proxy.
- Target: user's VPS, behind NGINX/Traefik and Cloudflare (fixem.be DNS is ready). Compose stays proxy-agnostic; deployment notes in README cover proxy + Cloudflare specifics.

## 10. Testing

- **Unit tests per adapter** with recorded fixture responses (no live network in CI). Fetching is injected/mockable per adapter.
- **Integration tests:** UA routing (crawler vs browser vs `?fixem=preview`), meta-HTML output correctness, oEmbed output, failure degradation (adapter throws → redirect), URL parsing edge cases (encoded, bare-host, garbage).
- Runner: `bun test`.

## 11. Project structure

```
src/
  index.ts            # Hono app entry
  routes/             # catch-all, oembed, healthz, video proxy
  ua.ts               # crawler detection
  resolver.ts         # cache + dedup + timeout + breaker
  adapters/           # <platform>.ts per platform + registry.ts + types.ts
  render/             # meta-html.ts, oembed.ts
  lib/                # redis, rate-limit, logger, config
public/               # landing page
tests/
  fixtures/<platform>/
docker/               # Dockerfile, compose
```

## 12. Milestones

1. **M1 — Skeleton:** Hono app, UA routing, meta-HTML renderer, oEmbed endpoint, Redis cache layer, Docker setup, landing page, one dummy adapter with fixture. Verify: run locally/tunnel, paste link in Discord.
2. **M2 — Easy platforms:** Reddit + Bluesky adapters + tests; deploy and verify in a real Discord server.
3. **M3 — API platforms:** Twitch Clips + Twitter/X.
4. **M4 — Hard platforms:** Threads, Instagram, TikTok + `/v/` video proxy route (Range support). **Open decision (deliberate):** proxy bandwidth strategy (cap+cache vs passthrough) — benchmark real usage at M4 before choosing.

Each milestone ends with documented Discord verification steps.

## 13. Decisions log

- Approach A chosen: single Hono app, layered core, adapter plugins (over micro-services or routing to existing fixers).
- NSFW: full embed with 🔞 marker.
- Video proxy strategy: deferred to M4 (benchmark first).
- VPS + domain are ready; compose designed for that, proxy-agnostic.
- In-flight dedup is in-process (single-instance deployment assumption).
- Model routing during development: Fable 5 for complex work (architecture, TikTok/Instagram scraping, UA edge cases, debugging); Opus 4.8 subagents for boilerplate (config, Dockerfile, README, simple routes, test scaffolding).
