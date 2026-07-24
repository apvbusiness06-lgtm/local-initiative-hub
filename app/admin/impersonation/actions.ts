"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { resolveTenant } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { writeAudit } from "@/lib/audit";
import {
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_TTL_SECONDS,
  signImpersonation,
  readImpersonation,
} from "@/lib/auth/impersonation";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function startImpersonationAction(targetUserId: string, formData: FormData): Promise<void> {
  const admin = await getCurrentUser();
  if (!admin) redirect("/login?next=/admin/users");

  // Impersonation is a platform-support power; users.impersonate is
  // deliberately PLATFORM-only in the seed (never granted to tenant admins).
  const allowed = await can(admin!.id, "users.impersonate");
  if (!allowed) redirect("/admin/users?error=forbidden");

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) redirect("/admin/users?error=reason_required");

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) redirect("/admin/users?error=notfound");
  if (target.id === admin!.id) redirect("/admin/users?error=self");

  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);

  await writeAudit(
    { actorUserId: admin!.id, impersonatedUserId: target.id, impersonationReason: reason, tenantId: tenant?.id ?? null },
    { action: "impersonation.started", subject: "user", subjectId: target.id, after: { reason, ttlSeconds: IMPERSONATION_TTL_SECONDS } }
  );

  const token = signImpersonation({ realUserId: admin!.id, targetUserId: target.id, reason });
  (await cookies()).set(IMPERSONATION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_TTL_SECONDS,
  });

  redirect("/");
}

export async function stopImpersonationAction(): Promise<void> {
  const jar = await cookies();
  const grant = readImpersonation(jar.get(IMPERSONATION_COOKIE_NAME)?.value);
  if (grant) {
    await writeAudit(
      { actorUserId: grant.realUserId, impersonatedUserId: grant.targetUserId, impersonationReason: grant.reason },
      { action: "impersonation.stopped", subject: "user", subjectId: grant.targetUserId }
    );
  }
  jar.delete(IMPERSONATION_COOKIE_NAME);
  redirect("/admin/users");
}
