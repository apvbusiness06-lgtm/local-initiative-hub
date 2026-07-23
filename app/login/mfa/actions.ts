"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { verifyTotp } from "@/lib/auth/totp";
import { createSession } from "@/lib/auth/session";
import { verifySignedPayload } from "@/lib/auth/signedToken";
import { SESSION_COOKIE_NAME, sessionCookieOptions, PENDING_MFA_COOKIE_NAME } from "@/lib/auth/cookieOptions";

const prisma = new PrismaClient();

export async function verifyMfaChallengeAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const pendingToken = jar.get(PENDING_MFA_COOKIE_NAME)?.value;
  const payload = pendingToken
    ? verifySignedPayload<{ userId: string; purpose: string }>(pendingToken)
    : null;

  if (!payload || payload.purpose !== "mfa_challenge") {
    redirect("/login?error=" + encodeURIComponent("Your login session expired. Log in again."));
  }

  const code = String(formData.get("code") ?? "");
  const user = await prisma.user.findUnique({ where: { id: payload!.userId } });
  if (!user?.mfaSecretEncrypted) {
    redirect("/login?error=" + encodeURIComponent("Two-factor authentication isn't set up on this account."));
  }

  const secret = decryptSecret(user!.mfaSecretEncrypted!);
  if (!verifyTotp(secret, code)) {
    redirect("/login/mfa?error=" + encodeURIComponent("Incorrect code. Try again."));
  }

  const requestHeaders = await headers();
  const session = await createSession(user!.id, {
    userAgent: requestHeaders.get("user-agent") ?? undefined,
    ipAddress: requestHeaders.get("x-forwarded-for") ?? undefined,
  });

  jar.delete(PENDING_MFA_COOKIE_NAME);
  jar.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
  redirect("/account");
}
