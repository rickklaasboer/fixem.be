import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountProxy } from "../src/proxy";
import { loadConfig } from "../src/lib/config";
import { createLogger } from "../src/lib/logger";
import { signProxyToken } from "../src/lib/proxy-sign";
import type { FetchFn } from "../src/adapters/types";

const SECRET = "s";
const silent = createLogger({ write: () => {} });

async function appWith(fetchFn: FetchFn, overrides: Record<string, string> = {}) {
  const config = loadConfig({ PROXY_SECRET: SECRET, ...overrides });
  const app = new Hono();
  mountProxy(app, { config, logger: silent, fetchFn, now: () => 1000 });
  return app;
}

async function tokenFor(url: string, headers: Record<string, string> = {}) {
  return signProxyToken(SECRET, { url, headers, exp: 2000 });
}

describe("/v/ proxy", () => {
  test("streams a 200 with forwarded headers and required upstream headers", async () => {
    let seen: Headers | undefined;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response("VIDEOBYTES", {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "10", "set-cookie": "x=1" },
      });
    }) as unknown as FetchFn;
    const app = await appWith(fetchFn);
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4", { Referer: "https://www.tiktok.com/" });
    const res = await app.request(`/v/${tok}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("set-cookie")).toBeNull(); // upstream cookie dropped
    expect(seen?.get("Referer")).toBe("https://www.tiktok.com/");
    expect(await res.text()).toBe("VIDEOBYTES");
  });

  test("forwards Range and preserves 206 + content-range", async () => {
    let seenRange: string | null | undefined;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seenRange = new Headers(init?.headers).get("Range");
      return new Response("PART", {
        status: 206,
        headers: { "content-range": "bytes 0-3/10", "content-length": "4" },
      });
    }) as unknown as FetchFn;
    const app = await appWith(fetchFn);
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4");
    const res = await app.request(`/v/${tok}`, { headers: { Range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(seenRange).toBe("bytes=0-3");
    expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
  });

  test("404 on bad token", async () => {
    const app = await appWith((async () => new Response("x")) as unknown as FetchFn);
    expect((await app.request("/v/garbage")).status).toBe(404);
  });

  test("403 when host not on allowlist", async () => {
    const app = await appWith((async () => new Response("x")) as unknown as FetchFn);
    const tok = await tokenFor("https://evil.test/a.mp4");
    expect((await app.request(`/v/${tok}`)).status).toBe(403);
  });

  test("502 when upstream errors", async () => {
    const app = await appWith((async () => new Response("no", { status: 500 })) as unknown as FetchFn);
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4");
    expect((await app.request(`/v/${tok}`)).status).toBe(502);
  });

  test("502 when non-range body exceeds byte ceiling", async () => {
    const fetchFn = (async () =>
      new Response("x", { status: 200, headers: { "content-length": "999999999" } })) as unknown as FetchFn;
    const app = await appWith(fetchFn, { PROXY_MAX_BYTES: "1000" });
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4");
    expect((await app.request(`/v/${tok}`)).status).toBe(502);
  });

  test("404 when proxy secret is unset (disabled)", async () => {
    const config = loadConfig({}); // no PROXY_SECRET
    const app = new Hono();
    mountProxy(app, { config, logger: silent, fetchFn: (async () => new Response("x")) as unknown as FetchFn, now: () => 1000 });
    const tok = await signProxyToken("s", { url: "https://v16.tiktokcdn.com/a.mp4", headers: {}, exp: 2000 });
    expect((await app.request(`/v/${tok}`)).status).toBe(404);
  });

  test("404 on expired token", async () => {
    const app = await appWith((async () => new Response("x")) as unknown as FetchFn);
    const expired = await signProxyToken(SECRET, { url: "https://v16.tiktokcdn.com/a.mp4", headers: {}, exp: 500 });
    expect((await app.request(`/v/${expired}`)).status).toBe(404); // now()=1000 > exp=500
  });

  test("follows a redirect to an allowlisted host and re-validates each hop", async () => {
    const hosts: string[] = [];
    const fetchFn = (async (input: unknown) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      if (url.hostname === "v16.tiktokcdn.com") {
        return new Response(null, { status: 302, headers: { location: "https://cdn.muscdn.com/signed.mp4" } });
      }
      return new Response("BYTES", { status: 200, headers: { "content-type": "video/mp4" } });
    }) as unknown as FetchFn;
    const app = await appWith(fetchFn);
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4");
    const res = await app.request(`/v/${tok}`);
    expect(res.status).toBe(200);
    expect(hosts).toEqual(["v16.tiktokcdn.com", "cdn.muscdn.com"]);
    expect(await res.text()).toBe("BYTES");
  });

  test("403 when a redirect points off the allowlist (SSRF guard)", async () => {
    const fetchFn = (async (input: unknown) => {
      if (new URL(String(input)).hostname === "v16.tiktokcdn.com") {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      return new Response("SECRET", { status: 200 });
    }) as unknown as FetchFn;
    const app = await appWith(fetchFn);
    const tok = await tokenFor("https://v16.tiktokcdn.com/a.mp4");
    expect((await app.request(`/v/${tok}`)).status).toBe(403);
  });
});
