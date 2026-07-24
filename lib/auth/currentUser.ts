import { cookies } from "next/headers";
import { getSessionByToken, SESSION_COOKIE_NAME, type SessionUser } from "@/lib/auth/session";
import { PrismaClient } from "@prisma/client";
import { IMPERSONATION_COOKIE_NAME, readImpersonation } from "@/lib/auth/impersonation";

const prisma = new PrismaClient();

/** The real, authenticated user — ignores any active impersonation. */
export async function getRealUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

export interface ImpersonationState {
  targetUserId: string;
  targetEmail: string;
  reason: string;
}

/**
 * The effective user for rendering — the impersonated target when a valid,
 * unexpired grant is present and the real user still holds users.impersonate;
 * otherwise the real user. Admin permission checks should use getRealUser(),
 * so impersonating a normal user drops admin powers (you see what they see).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const real = await getRealUser();
  if (!real) return null;

  const grant = readImpersonation((await cookies()).get(IMPERSONATION_COOKIE_NAME)?.value);
  if (!grant || grant.realUserId !== real.id) return real;

  const target = await prisma.user.findUnique({ where: { id: grant.targetUserId } });
  if (!target) return real;
  return {
    id: target.id,
    email: target.email,
    emailVerifiedAt: target.emailVerifiedAt,
    mfaEnrolledAt: target.mfaEnrolledAt,
  };
}

/** Impersonation banner data: the real admin + who they're viewing as. */
export async function getImpersonation(): Promise<ImpersonationState | null> {
  const real = await getRealUser();
  if (!real) return null;
  const grant = readImpersonation((await cookies()).get(IMPERSONATION_COOKIE_NAME)?.value);
  if (!grant || grant.realUserId !== real.id) return null;

  const target = await prisma.user.findUnique({ where: { id: grant.targetUserId } });
  if (!target) return null;
  return { targetUserId: target.id, targetEmail: target.email, reason: grant.reason };
}
