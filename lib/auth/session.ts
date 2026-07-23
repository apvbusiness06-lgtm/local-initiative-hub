// Deliberately Next-agnostic — same pattern as lib/tenant.ts's
// resolveTenant(hostname): pure functions taking explicit arguments, so
// they're testable without a running Next request context and so the only
// place that reads a cookie is the thin route/page wrapper that calls in.
import { randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE_NAME = "li_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta?: { userAgent?: string; ipAddress?: string }
): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export interface SessionUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  mfaEnrolledAt: Date | null;
}

export async function getSessionByToken(token: string): Promise<SessionUser | null> {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Best-effort — a missed touch doesn't invalidate the session.
  void prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});

  return {
    id: session.user.id,
    email: session.user.email,
    emailVerifiedAt: session.user.emailVerifiedAt,
    mfaEnrolledAt: session.user.mfaEnrolledAt,
  };
}

export async function destroySessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

/** Session invalidation on password change/reset: every existing session dies. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
