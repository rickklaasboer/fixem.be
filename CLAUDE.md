# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit attribution

Do **not** add Claude commit attribution. Do not append `Co-Authored-By: Claude ...` trailers or "Generated with Claude Code" lines to commit messages or PR bodies. Commit and author as the human user only.

## What this is

**fixem.be** — a Discord embed-fixer. Prepend `https://fixem.be/` to a social-media URL; the service serves rich OpenGraph/Twitter-Card metadata to link-preview crawlers (Discord, Telegram, Slack, …) and `302`-redirects real browsers to the original. Bun + Hono, TypeScript strict. Redis/Valkey for caching + rate limiting.

## Commands

```bash
bun install            # deps (hono is the ONLY runtime dependency)
bun run dev            # dev server on :3000 (--watch)
bun test               # full suite — no live network (fixtures + injected fetchFn)
bun test tests/x.test.ts        # single file
bun test -t "name substring"    # single test by name
bunx tsc --noEmit      # typecheck (strict); must be clean before committing
docker compose up -d --build    # app + Valkey; app on 127.0.0.1:3000
```

Config is all env vars (see `.env.example`, loaded by `src/lib/config.ts`); `.env` is gitignored and holds real secrets — never read, print, or commit it.

## Architecture

Layered, single Hono app. Data flows one direction:

**routes** (`src/app.ts`, `src/ua.ts`, `src/url.ts`) → **resolver** (`src/resolver.ts`) → **adapters** (`src/adapters/*`) → **renderers** (`src/render/*`).

- `src/app.ts` — the catch-all route parses the wrapped target URL, branches on `User-Agent`: known crawlers (or the `/preview/<url>` path prefix) get resolved + rendered embed HTML; everyone else gets a `302` (no resolve on that path). Rate-limits non-crawlers. `onError` + the resolver guarantee a well-formed URL **never** 500s. Also mounts the `/v/` proxy and, at render time, rewrites `video.proxyHeaders` media into signed `/v/` URLs (`withProxiedVideo`).
- `src/resolver.ts` — cache (`meta:<canonical>`), in-flight dedup, per-resolve timeout, per-platform circuit breaker, and a top-level guard so `resolve()` never throws (degrades instead). Honors `EmbedMetadata.ttlSeconds`.
- `src/adapters/*` — one `PlatformAdapter` per platform (`registry.ts` picks the first whose `match()` hits; wired in `src/index.ts`). Each is a pure **URL → `EmbedMetadata`** factory taking an injected `fetchFn` (so tests use recorded fixtures, no network). Adapters **throw** on failure; the resolver degrades. Reachable-but-refused (login walls, unavailable posts) return an informative `kind:"link"` embed rather than throwing.
- `src/render/{meta-html,oembed}.ts` — build the crawler HTML + oEmbed JSON from one `EmbedMetadata`. `meta-html` escapes every interpolated value.
- `src/proxy.ts` — `GET /v/:token`: HMAC-verified (`src/lib/proxy-sign.ts`), host-allowlisted, https-only, re-validates every redirect hop (SSRF guard), forwards `Range`, streams with concurrency + byte caps. Used for platforms whose media CDN needs headers Discord won't send.

## Conventions (follow these)

- **Runtime deps: `hono` only.** No other npm runtime packages. Redis is Bun's built-in `RedisClient`; crypto is Web Crypto.
- **Tests never hit the network** — inject `fetchFn`, use `as unknown as FetchFn`, record trimmed fixtures under `tests/fixtures/<platform>/`.
- **`match()` compares `url.hostname` by exact Set membership** — never substrings (SSRF/spoofing).
- **Version-fragile platform constants** (doc_ids, app-ids, GQL hashes, mobile-API ids) are env-overridable with pinned defaults, using `||`-fallback (so a blank `.env` value still uses the default — `??` would leak `""`).
- Redis/proxy clients fail **open** (`enableOfflineQueue: false`); a Redis outage runs cache-less, never blocks a request.

## Platform realities (hard-won; don't relearn the hard way)

- **Reddit**: the anonymous `.json` API is dead globally (403 + web-app shell). Self-serve API keys were removed in 2025 (approval-gated). Default path scrapes **old.reddit.com** HTML (images/galleries/text/NSFW; video → poster only). `REDDIT_CLIENT_ID/SECRET` unlock the OAuth JSON path (full video) if you ever get approved.
- **Instagram**: login-walled from datacenter *and* residential IPs. Works with a **burner session cookie** (`INSTAGRAM_COOKIE`) via the mobile `i.instagram.com/api/v1/media/<id>/info` API (stable — the web GraphQL `doc_id` rotates constantly). Optional `INSTAGRAM_SNAPSAVE=true` third-party fallback. The cookie is a full account credential: only sent on the metadata call, never logged, never placed in a `/v/` token.
- **Threads**: Meta bot-blocks the anonymous GraphQL from normal server IPs (returns an HTML challenge) — degrades to an informative card. Pinned `doc_id`/`lsd` rotate.
- **TikTok**: web `__UNIVERSAL_DATA_FOR_REHYDRATION__` scrape; play URLs are IP/cookie-locked → streamed through `/v/` with the page's `ttwid`/`tt_csrf` cookies forwarded.
- **Twitch**: needs `TWITCH_CLIENT_ID/SECRET` (Helix metadata + public GQL for the signed MP4); clip MP4s play **direct** (no `/v/`).
- **Video proxy**: enable with `PROXY_SECRET`. In production put `/v/` (or `v.fixem.be`) on a Cloudflare **DNS-only / grey-cloud** record — never proxy video through the orange cloud (CF ToS 2.8).

## Notes

- The design spec and per-milestone implementation plans live under `docs/` — **gitignored / local-only**, not in source control.
- Runs on a VPS behind a reverse proxy + Cloudflare; the reverse proxy must forward the real client IP (`CF-Connecting-IP`/`X-Forwarded-For`) or rate limiting collapses to one bucket.
