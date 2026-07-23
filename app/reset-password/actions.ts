"use server";

import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { hashRawToken } from "@/lib/auth/tokens";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { checkTokenValidity } from "@/lib/auth/tokenValidity";

const prisma = new PrismaClient();

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const fail = (message: string) =>
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);

  if (!token) fail("Missing reset token.");

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashRawToken(token) } });
  if (!record) fail("This reset link isn't valid.");
  const validity = checkTokenValidity(record!);
  if (validity === "already-used") fail("This reset link has already been used. Request a new one.");
  if (validity === "expired") fail("This reset link has expired. Request a new one.");

  const strengthError = validatePasswordStrength(password);
  if (strengthError) fail(strengthError);
  if (password !== confirmPassword) fail("Passwords don't match.");

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record!.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record!.id }, data: { consumedAt: new Date() } }),
  ]);

  // Session invalidation on password change: every existing session for
  // this user is dead, on this device and anywhere else it was logged in.
  await destroyAllSessionsForUser(record!.userId);

  redirect("/login?reset=success");
}
