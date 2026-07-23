// RFC 6238 TOTP (RFC 4226 HOTP + a time-derived counter), SHA-1/6-digit/30s
// — the parameters every authenticator app (Google/Microsoft/Authy) assumes
// by default. No external dependency: this is ~30 lines of HMAC truncation,
// verified against the RFC 6238 Appendix B test vectors in tests/totp.test.ts
// rather than trusted on sight.
import { createHmac, randomBytes } from "node:crypto";
import { base32Encode, base32Decode } from "@/lib/base32";

function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Exposed for testing against RFC 6238's fixed-time vectors. */
export function totpAt(secretBase32: string, epochMs: number, step = 30, digits = 6): string {
  const counter = BigInt(Math.floor(epochMs / 1000 / step));
  return hotp(base32Decode(secretBase32), counter, digits);
}

export function generateTotp(secretBase32: string): string {
  return totpAt(secretBase32, Date.now());
}

/** Accepts one step of clock drift either side by default. */
export function verifyTotp(secretBase32: string, token: string, window = 1, step = 30): boolean {
  const trimmed = token.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    if (totpAt(secretBase32, now + w * step * 1000, step) === trimmed) return true;
  }
  return false;
}

export function otpauthUri(secretBase32: string, accountEmail: string, issuer = "Local Initiative"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
