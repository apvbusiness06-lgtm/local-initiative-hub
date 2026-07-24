"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { getRealUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { setListingStatus, resolveModerationReport, setPlacementFlags, moderateReview } from "@/lib/admin";
import type { AuditContext } from "@/lib/audit";
import type { ListingStatus } from "@prisma/client";

// Admin actions use the REAL user (impersonation drops admin powers), and
// require listings.approve on the tenant resolved from the host.
async function adminGuard(): Promise<{ ctx: AuditContext; tenantId: string }> {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getRealUser()]);
  if (!tenant) redirect("/");
  if (!user) redirect("/login?next=/admin");
  if (!(await can(user!.id, "listings.approve", { tenantId: tenant!.id }))) redirect("/admin?error=forbidden");
  return { ctx: { actorUserId: user!.id, tenantId: tenant!.id }, tenantId: tenant!.id };
}

export async function setListingStatusAction(businessId: string, status: string): Promise<void> {
  const { ctx } = await adminGuard();
  const valid: ListingStatus[] = ["ACTIVE", "SUSPENDED", "REJECTED", "PENDING", "NEEDS_CHANGES"];
  if (!valid.includes(status as ListingStatus)) redirect("/admin/businesses?error=badstatus");
  const result = await setListingStatus(ctx, businessId, status as ListingStatus);
  redirect(`/admin/businesses?${result.ok ? "done=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}

export async function resolveReportAction(reportId: string, decision: string): Promise<void> {
  const { ctx } = await adminGuard();
  const d = decision === "approve" ? "approve" : "dismiss";
  const result = await resolveModerationReport(ctx, reportId, d);
  redirect(`/admin/moderation?${result.ok ? "done=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}

export async function moderateReviewAction(reviewId: string, decision: string): Promise<void> {
  const { ctx } = await adminGuard();
  const d = decision === "approve" ? "approve" : decision === "hide" ? "hide" : "reject";
  const result = await moderateReview(ctx, reviewId, d);
  redirect(`/admin/reviews?${result.ok ? "done=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}

export async function togglePlacementAction(placementId: string, formData: FormData): Promise<void> {
  const { ctx, tenantId } = await adminGuard();
  const flags: { isFeatured?: boolean; isSponsored?: boolean; approve?: boolean } = {};
  const field = String(formData.get("field") ?? "");
  const value = formData.get("value") === "true";
  if (field === "featured") flags.isFeatured = value;
  else if (field === "sponsored") flags.isSponsored = value;
  else if (field === "approve") flags.approve = true;
  const result = await setPlacementFlags(ctx, tenantId, placementId, flags);
  redirect(`/admin/businesses?${result.ok ? "done=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}
