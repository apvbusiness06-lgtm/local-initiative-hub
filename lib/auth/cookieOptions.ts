// Shared cookie attributes for the thin Next-specific wrappers (Server
// Actions, Route Handlers) around the pure session/token logic in
// lib/auth/session.ts and lib/auth/signedToken.ts.
export { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
};

export const PENDING_MFA_COOKIE_NAME = "li_pending_mfa";
export const PENDING_MFA_TTL_SECONDS = 60 * 5; // 5 minutes

export const pendingMfaCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: PENDING_MFA_TTL_SECONDS,
};
