"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { hasPlatformRole } from "@/lib/auth/rbac";
import { signPayload } from "@/lib/auth/signedToken";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  PENDING_MFA_COOKIE_NAME,
  PENDING_MFA_TTL_SECONDS,
  pendingMfaCookieOptions,
} from "@/lib/auth/cookieOptions";

const prisma = new PrismaClient();

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  const invalid = () => redirect("/login?error=" + encodeURIComponent("Incorrect email or password."));

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) invalid();
  const ok = await verifyPassword(password, user!.passwordHash!);
  if (!ok) invalid();

  if (!user!.emailVerifiedAt) {
    redirect("/login?error=" + encodeURIComponent("Verify your email address before logging in."));
  }

  const jar = await cookies();
  const requestHeaders = await headers();
  const meta = {
    userAgent: requestHeaders.get("user-agent") ?? undefined,
    ipAddress: requestHeaders.get("x-forwarded-for") ?? undefined,
  };

  if (user!.mfaSecretEncrypted) {
    const pending = signPayload({ userId: user!.id, purpose: "mfa_challenge" }, PENDING_MFA_TTL_SECONDS);
    jar.set(PENDING_MFA_COOKIE_NAME, pending, pendingMfaCookieOptions);
    redirect("/login/mfa");
  }

  if (await hasPlatformRole(user!.id)) {
    const pending = signPayload({ userId: user!.id, purpose: "mfa_setup_required" }, PENDING_MFA_TTL_SECONDS);
    jar.set(PENDING_MFA_COOKIE_NAME, pending, pendingMfaCookieOptions);
    redirect("/account/mfa/setup?forced=1");
  }

  const session = await createSession(user!.id, meta);
  jar.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
  redirect("/account");
}
