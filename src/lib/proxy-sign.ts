export interface ProxyPayload {
  url: string;
  headers: Record<string, string>;
  exp: number; // epoch ms
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function signProxyToken(secret: string, payload: ProxyPayload): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifyProxyToken(
  secret: string,
  token: string,
  now: number,
): Promise<ProxyPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  let expected: Uint8Array;
  try {
    expected = await hmac(secret, body);
  } catch {
    return null;
  }
  let given: Uint8Array;
  try {
    given = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as ProxyPayload;
    if (typeof payload.exp !== "number" || now >= payload.exp) return null;
    if (typeof payload.url !== "string" || typeof payload.headers !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}
