import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { checkTenantAdminAccess } from "@/lib/auth/adminGuard";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const result = await checkTenantAdminAccess(token, tenantId);
  return NextResponse.json(result.body, { status: result.status });
}
