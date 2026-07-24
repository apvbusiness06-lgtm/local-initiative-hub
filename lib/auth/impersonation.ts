// Support impersonation (Slice 8). Time-limited and self-expiring: the grant
// is a stateless HMAC-signed payload (same primitive as the MFA challenge)
// with an embedded expiry, so it CANNOT outlive its TTL — there's no server
// row to forget to clean up, and a tampered cookie fails the signature. A
// visible banner is mandatory, and every action taken while impersonating is
// audited under BOTH the real admin and the impersonated user (see
// lib/audit.ts).

import { signPayload, verifySignedPayload } from "@/lib/auth/signedToken";

export const IMPERSONATION_COOKIE_NAME = "li_impersonation";
// Deliberately short: impersonation is a break-glass support action, not a
// mode you leave running.
export const IMPERSONATION_TTL_SECONDS = 30 * 60;

export interface ImpersonationGrant {
  realUserId: string;
  targetUserId: string;
  reason: string;
}

export function signImpersonation(grant: ImpersonationGrant): string {
  return signPayload(
    { realUserId: grant.realUserId, targetUserId: grant.targetUserId, reason: grant.reason },
    IMPERSONATION_TTL_SECONDS
  );
}

/**
 * Returns the grant only if the signature is valid AND it hasn't expired.
 * verifySignedPayload enforces the embedded `exp`, so an expired grant reads
 * as null — impersonation ends automatically, no revocation step needed.
 */
export function readImpersonation(cookieValue: string | undefined): ImpersonationGrant | null {
  if (!cookieValue) return null;
  const payload = verifySignedPayload<Record<string, unknown>>(cookieValue);
  if (!payload) return null;
  const { realUserId, targetUserId, reason } = payload;
  if (typeof realUserId !== "string" || typeof targetUserId !== "string") return null;
  if (typeof reason !== "string" || reason.length === 0) return null;
  return { realUserId, targetUserId, reason };
}
