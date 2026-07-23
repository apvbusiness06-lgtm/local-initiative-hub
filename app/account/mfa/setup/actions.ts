"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { verifyTotp } from "@/lib/auth/totp";
import { encryptSecret } from "@/lib/crypto";
import { createSession } from "@/lib/auth/session";
import { resolveMfaSetupIdentity } from "@/lib/auth/mfaSetupIdentity";
import { SESSION_COOKIE_NAME, sessionCookieOptions, PENDING_MFA_COOKIE_NAME } from "@/lib/auth/cookieOptions";

const prisma = new PrismaClient();

export async function confirmMfaEnrolmentAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const identity = await resolveMfaSetupIdentity(
    jar.get(SESSION_COOKIE_NAME)?.value,
    jar.get(PENDING_MFA_COOKIE_NAME)?.value
  );
  if (!identity) redirect("/login");

  const secret = String(formData.get("secret") ?? "");
  const code = String(formData.get("code") ?? "");

  if (!verifyTotp(secret, code)) {
    const forcedQs = identity!.forced ? "&forced=1" : "";
    redirect(
      `/account/mfa/setup?secret=${encodeURIComponent(secret)}&error=` +
        encodeURIComponent("Incorrect code — check your authenticator app and try again.") +
        forcedQs
    );
  }

  await prisma.user.update({
    where: { id: identity!.userId },
    data: { mfaSecretEncrypted: encryptSecret(secret), mfaEnrolledAt: new Date() },
  });

  if (identity!.forced) {
    const requestHeaders = await headers();
    const session = await createSession(identity!.userId, {
      userAgent: requestHeaders.get("user-agent") ?? undefined,
      ipAddress: requestHeaders.get("x-forwarded-for") ?? undefined,
    });
    jar.delete(PENDING_MFA_COOKIE_NAME);
    jar.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions);
  }

  redirect("/account?mfaEnrolled=1");
}
