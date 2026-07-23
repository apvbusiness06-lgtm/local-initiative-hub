// Stateless, short-lived signed payloads (HMAC-SHA256 over AUTH_SECRET) for
// the gap between "password verified" and "full session issued" — the MFA
// challenge and forced-enrolment steps. No DB row needed: the signature and
// embedded expiry are the only trust anchor, so these must stay short-lived
// (minutes) and single-purpose.
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}

export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const json = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [json, sig] = token.split(".");
  if (!json || !sig) return null;

  const expectedSig = createHmac("sha256", getSecret()).update(json).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
