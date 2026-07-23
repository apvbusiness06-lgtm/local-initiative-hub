import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashRawToken } from "@/lib/auth/tokens";
import { checkTokenValidity } from "@/lib/auth/tokenValidity";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  // request.url reflects Next's internal origin, not the tenant's public
  // hostname — building the redirect from it would bounce a tenant-hosted
  // click through localhost and lose tenant resolution entirely. Rebuild
  // it from the actual incoming Host header instead.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const redirectTo = (status: string) =>
    NextResponse.redirect(`${protocol}://${host}/verify-email?status=${status}`);

  if (!token) return redirectTo("invalid");

  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashRawToken(token) } });
  if (!record) return redirectTo("invalid");
  const validity = checkTokenValidity(record);
  if (validity !== "usable") return redirectTo(validity);

  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);

  return redirectTo("success");
}
