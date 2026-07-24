"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { approveClaim, rejectClaim, reviewingTenantForBusiness } from "@/lib/claims";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Authorization for a claim decision: the reviewer must hold listings.approve
// on the tenant that is canonical for this claim's business (a platform
// super-admin passes via can()'s PLATFORM-scope branch). This is enforced
// here in the action layer, not just hidden in the UI.
async function authorizeClaimReview(claimId: string): Promise<{ userId: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const claim = await prisma.listingClaim.findUnique({ where: { id: claimId }, select: { businessId: true } });
  if (!claim) return null;

  const tenantId = await reviewingTenantForBusiness(claim.businessId);
  const allowed = await can(user.id, "listings.approve", tenantId ? { tenantId } : {});
  return allowed ? { userId: user.id } : null;
}

export async function approveClaimAction(claimId: string): Promise<void> {
  const auth = await authorizeClaimReview(claimId);
  if (!auth) redirect("/admin/claims?error=forbidden");

  const result = await approveClaim(claimId, auth!.userId);
  redirect(`/admin/claims?${result.ok ? "approved=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}

export async function rejectClaimAction(claimId: string, formData: FormData): Promise<void> {
  const auth = await authorizeClaimReview(claimId);
  if (!auth) redirect("/admin/claims?error=forbidden");

  const reason = String(formData.get("reason") ?? "").trim() || "No reason given";
  const result = await rejectClaim(claimId, auth!.userId, reason);
  redirect(`/admin/claims?${result.ok ? "rejected=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}`);
}
