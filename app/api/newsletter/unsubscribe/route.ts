// One-click unsubscribe from the emailed token — NO login required (Slice 13
// acceptance). Withdraws consent so marketing stops immediately.

import { NextRequest, NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import { unsubscribeByToken } from "@/lib/newsletter";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${proto}://${host}`;

  const token = request.nextUrl.searchParams.get("token");
  const tenant = await resolveTenant(host);
  if (!tenant || !token) {
    return NextResponse.redirect(`${origin}/newsletter/unsubscribed?state=invalid`);
  }

  const result = await unsubscribeByToken(tenant.id, token);
  return NextResponse.redirect(`${origin}/newsletter/unsubscribed?state=${result.ok ? "ok" : "invalid"}`);
}
