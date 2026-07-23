"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { generateRawToken, hashRawToken } from "@/lib/auth/tokens";
import { getMailer } from "@/lib/mailer";

const prisma = new PrismaClient();
const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  // Always the same response regardless of whether the account exists —
  // and unlike registration's confirmation page, the sandbox link is never
  // shown here, only logged server-side, or a UI difference between
  // "account exists" and "account doesn't" becomes an enumeration oracle.
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

  if (user) {
    const rawToken = generateRawToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRawToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    const host = (await headers()).get("host") ?? "localhost:3000";
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    const resetUrl = `${proto}://${host}/reset-password?token=${rawToken}`;

    await getMailer().send({
      to: email,
      subject: "Reset your Local Initiative password",
      text: `Reset your password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    });
  }

  redirect("/forgot-password?sent=1");
}
