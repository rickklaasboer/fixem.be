import type { AdapterRegistry } from "./adapters/registry";
import type { EmbedMetadata } from "./adapters/types";
import type { MetadataCache } from "./lib/cache";
import type { Logger } from "./lib/logger";

export type ResolveOutcome =
  | { status: "ok"; meta: EmbedMetadata; canonicalUrl: string; platform: string; cacheHit: boolean }
  | { status: "no-adapter" }
  | { status: "degraded"; canonicalUrl: string; platform: string; reason: string };

export interface ResolverOptions {
  registry: AdapterRegistry;
  cache: MetadataCache;
  logger: Logger;
  ttlSeconds: number;
  timeoutMs: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  now?: () => number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class Resolver {
  private readonly inflight = new Map<string, Promise<ResolveOutcome>>();
  private readonly failures = new Map<string, { count: number; openUntil: number }>();
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: ResolverOptions) {
    this.breakerThreshold = opts.breakerThreshold ?? 5;
    this.breakerCooldownMs = opts.breakerCooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  canonicalFor(url: URL): { canonicalUrl: string; platform: string } | null {
    const adapter = this.opts.registry.find(url);
    if (!adapter) return null;
    return { canonicalUrl: adapter.canonicalize(url), platform: adapter.name };
  }

  async resolve(url: URL): Promise<ResolveOutcome> {
    const adapter = this.opts.registry.find(url);
    if (!adapter) return { status: "no-adapter" };
    const canonicalUrl = adapter.canonicalize(url);
    const platform = adapter.name;

    // Cache first, breaker second: a fresh cached embed needs no adapter
    // call, so an open breaker must not degrade it.
    const key = `meta:${canonicalUrl}`;
    const cached = await this.opts.cache.get(key);
    if (cached !== null) {
      try {
        const meta = JSON.parse(cached) as EmbedMetadata;
        return { status: "ok", meta, canonicalUrl, platform, cacheHit: true };
      } catch {
        // corrupt cache entry — fall through to a fresh resolve
      }
    }

    const breaker = this.failures.get(platform);
    if (breaker && breaker.openUntil > this.now()) {
      return { status: "degraded", canonicalUrl, platform, reason: "breaker-open" };
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.doResolve(url, canonicalUrl, platform, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  private async doResolve(
    url: URL,
    canonicalUrl: string,
    platform: string,
    key: string,
  ): Promise<ResolveOutcome> {
    const adapter = this.opts.registry.find(url)!;
    const started = this.now();
    try {
      const meta = await withTimeout(adapter.resolve(url), this.opts.timeoutMs);
      this.failures.delete(platform);
      await this.opts.cache.setEx(key, this.opts.ttlSeconds, JSON.stringify(meta));
      this.opts.logger.info(
        { platform, cache: "miss", latencyMs: this.now() - started },
        "resolved",
      );
      return { status: "ok", meta, canonicalUrl, platform, cacheHit: false };
    } catch (err) {
      const reason = err instanceof Error && err.message === "timeout" ? "timeout" : "error";
      const f = this.failures.get(platform) ?? { count: 0, openUntil: 0 };
      f.count += 1;
      if (f.count >= this.breakerThreshold) {
        f.openUntil = this.now() + this.breakerCooldownMs;
        f.count = 0;
      }
      this.failures.set(platform, f);
      this.opts.logger.warn(
        { platform, reason, latencyMs: this.now() - started, err: String(err) },
        "resolve failed",
      );
      return { status: "degraded", canonicalUrl, platform, reason };
    }
  }
}
