// Single-use tokens for email verification and password reset: the raw
// token goes in the emailed link only, its SHA-256 hash is what's stored —
// a leaked database row (backup, log line, replica) is never itself a
// usable token.
import { randomBytes, createHash } from "node:crypto";

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRawToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
