# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit attribution

Do **not** add Claude commit attribution. Do not append `Co-Authored-By: Claude ...` trailers or "Generated with Claude Code" lines to commit messages or PR bodies. Commit and author as the human user only.

## What this is

**fixem.be** — a Discord embed-fixer. Prepend `https://fixem.be/` to a social-media URL; the service serves rich OpenGraph/Twitter-Card metadata to link-preview crawlers (Discord, Telegram, Slack, …) and `302`-redirects real browsers to the original. Bun + Hono, TypeScript strict. Redis/Valkey for caching + rate limiting.

## Commands

```bash
bun install            # deps (runtime: hono, tsyringe, reflect-metadata)
bun run dev            # dev server on :3000 (--watch)
bun test               # full suite — no live network (fixtures + injected fakes)
bun test tests/x.test.ts        # single file
bun test -t "name substring"    # single test by name
bunx tsc --noEmit      # typecheck (strict); must be clean before committing
docker compose up -d --build    # app + Valkey; app on 127.0.0.1:3000
```

Config is all env vars (see `.env.example`, loaded by `loadConfig()` in `src/config/Config.ts`); `.env` is gitignored and holds real secrets — never read, print, or commit it.

## Architecture

Object-oriented / MVC-ish, wired by a `tsyringe` DI container (class-as-token, no string tokens). Data flows one direction:

**routes** (`src/http/routes.ts`) → **controllers** (`src/http/controllers/*`) → **resolver** (`src/domain/Resolver.ts`) → **adapters** (`src/adapters/*Adapter.ts`) → **renderers** (`src/render/*Renderer.ts`).

- `src/index.ts` → `src/bootstrap.ts` — `index.ts` imports `reflect-metadata` first, then `bootstrap()` registers the leaf instances (`Config`, `Logger`, `HttpClient`, `Cache`, `RateLimitStore`), builds the ordered adapter array (conditional Twitch) into `AdapterRegistry`, and binds routes via `src/http/routes.ts`. `src/container.ts` exports the container + the `app()` resolve helper. Everything else is `@injectable`/`@singleton` and resolves on demand.
- `src/http/controllers/EmbedController.ts` — the catch-all `*` handler: parses the wrapped target, branches on `User-Agent` (known crawlers, or the `/preview/<url>` prefix, get resolved + rendered embed HTML; everyone else gets a `302`). `onError` + the resolver guarantee a well-formed URL **never** 500s. Rewrites `video.proxyHeaders` media into signed `/v/` URLs via `VideoProxy`.
- `src/http/middleware/*` — `ApiAuthMiddleware` gates `/api/*` (closed 404 when no key); `RateLimitMiddleware` limits `/oembed` + `*` (known crawlers bypass; `/preview/` does **not**). `/v/` limits **all** clients unconditionally inside `ProxyStreamer`.
- `src/domain/Resolver.ts` — cache (`meta:<canonical>`), in-flight dedup, per-resolve timeout, per-platform circuit breaker, and a top-level guard so `resolve()` never throws (degrades instead). Honors `EmbedMetadata.ttlSeconds`. `AdapterRegistry` picks the first adapter whose `match()` hits.
- `src/adapters/*Adapter.ts` — one `@injectable` `PlatformAdapter` per platform, extending `BaseAdapter`; a pure **URL → `EmbedMetadata`** unit taking an injected `HttpClient` (+ `Config` where needed), so tests use recorded fixtures, no network. Adapters **throw** on failure; the resolver degrades. Reachable-but-refused (login walls, unavailable posts) return an informative `kind:"link"` card via `BaseAdapter.linkCard()` rather than throwing.
- `src/render/{MetaHtmlRenderer,OembedRenderer}.ts` — build the crawler HTML + oEmbed JSON from one `EmbedMetadata`. `MetaHtmlRenderer` escapes every interpolated value.
- `src/services/ProxyStreamer.ts` — `GET /v/:token`: HMAC-verified (`ProxySigner`), host-allowlisted, https-only, re-validates every redirect hop (SSRF guard), forwards `Range`, streams with concurrency + byte caps. `VideoProxy` signs the `/v/` tokens at render time. Used for platforms whose media CDN needs headers Discord won't send.

## Conventions (follow these)

- **Runtime deps: `hono`, `tsyringe`, `reflect-metadata` only.** No other npm runtime packages. DI is a tsyringe container using class-as-token (no string tokens); `reflect-metadata` is imported once at the entrypoint. Redis is Bun's built-in `RedisClient`; crypto is Web Crypto.
- **Layout & DI:** files are PascalCase named for the class/type they `export default` (`RedditAdapter.ts`), folders are lowercase, imports use the `@/` alias. Injected deps must be **value imports** (`import Foo`, never `import type Foo`) so `emitDecoratorMetadata` sees them — biome's `useImportType` is disabled for this reason. Multi-impl contracts (`Cache`, `RateLimitStore`) are abstract classes used as the token; single-impl services are concrete classes; pure contracts (`PlatformAdapter`, `EmbedMetadata`) are interfaces.
- **Tests never hit the network** — inject a fake `HttpClient` (`new HttpClient(mockFetch as unknown as FetchFn)`) or structural fakes cast to the class, record trimmed fixtures under `tests/fixtures/<platform>/`. Integration tests build the app via `createTestApp()` (a child container).
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
