"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { generateRawToken, hashRawToken } from "@/lib/auth/tokens";
import { getMailer } from "@/lib/mailer";

const prisma = new PrismaClient();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24h

export async function registerAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!EMAIL_RE.test(email)) {
    redirect("/register?error=" + encodeURIComponent("Enter a valid email address."));
  }
  const strengthError = validatePasswordStrength(password);
  if (strengthError) {
    redirect("/register?error=" + encodeURIComponent(strengthError));
  }
  if (password !== confirmPassword) {
    redirect("/register?error=" + encodeURIComponent("Passwords don't match."));
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect("/register?error=" + encodeURIComponent("An account with that email already exists."));
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const rawToken = generateRawToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRawToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  const host = (await headers()).get("host") ?? "localhost:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const verifyUrl = `${proto}://${host}/api/auth/verify-email?token=${rawToken}`;

  const result = await getMailer().send({
    to: email,
    subject: "Verify your Local Initiative account",
    text: `Welcome to Local Initiative. Verify your email address:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  });

  redirect(`/register?sent=1${result.sandbox ? `&sandboxToken=${rawToken}` : ""}`);
}
