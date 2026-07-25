// Claim-link confirmation. The claimant clicking this proves they control
// the business's on-file email. It does NOT grant ownership — it advances the
// claim into the admin review queue. Single-use and expiring; see
// lib/claims.ts::consumeClaimToken.

import { NextRequest, NextResponse } from "next/server";
import { consumeClaimToken } from "@/lib/claims";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  // Redirects are built from the incoming Host header (tenant-correct), not
  // request.url — the same fix the verify-email route needed.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${proto}://${host}`;

  if (!token) {
    return NextResponse.redirect(`${origin}/claim/verify/result?state=invalid`);
  }

  const result = await consumeClaimToken(token);
  if (!result.ok) {
    return NextResponse.redirect(`${origin}/claim/verify/result?state=${result.reason}`);
  }

  const business = await prisma.business.findUnique({
    where: { id: result.businessId },
    select: { slug: true },
  });
  const slugParam = business ? `&slug=${encodeURIComponent(business.slug)}` : "";
  return NextResponse.redirect(`${origin}/claim/verify/result?state=ok${slugParam}`);
}
