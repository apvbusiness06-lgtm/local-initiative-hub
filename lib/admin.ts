// Slice 8 — admin backend data + mutations. Two scoping rules:
//   - businesses / listing_claims / moderation_reports carry no RLS, so
//     queries here filter to "businesses this tenant is canonical for" via
//     canonical_tenant_for_subject() (the SECURITY DEFINER helper).
//   - directory_placements DOES carry RLS, so placement reads/writes go
//     through withTenant().
// Every state-changing action writes an AuditLog through lib/audit.ts,
// carrying the impersonation identity when one is active.

import { Prisma, PrismaClient, type ListingStatus } from "@prisma/client";
import { withTenant } from "./tenant";
import { writeAudit, type AuditContext } from "./audit";
import { can } from "./auth/rbac";

const prisma = new PrismaClient();

export async function isTenantAdmin(userId: string, tenantId: string, permission = "listings.approve"): Promise<boolean> {
  return can(userId, permission, { tenantId });
}

// ── Moderation queue ─────────────────────────────────────────
export interface ModerationRow {
  id: string;
  reason: string;
  detail: string | null;
  reporterEmail: string | null;
  createdAt: Date;
  businessId: string;
  businessName: string;
  businessSlug: string;
  businessStatus: ListingStatus;
}

export async function pendingModeration(tenantId: string): Promise<ModerationRow[]> {
  return prisma.$queryRaw<ModerationRow[]>(Prisma.sql`
    SELECT mr.id, mr.reason, mr.detail, mr.reporter_email AS "reporterEmail", mr.created_at AS "createdAt",
           b.id AS "businessId", b.trading_name AS "businessName", b.slug AS "businessSlug", b.status AS "businessStatus"
    FROM moderation_reports mr
    JOIN businesses b ON b.id = mr.subject_id AND mr.subject = 'BUSINESS'
    WHERE mr.status = 'PENDING'
      AND canonical_tenant_for_subject('BUSINESS'::"PlacementSubject", b.id) = ${tenantId}::uuid
    ORDER BY mr.created_at ASC
  `);
}

// ── Listing management ───────────────────────────────────────
export interface AdminListingRow {
  id: string;
  tradingName: string;
  slug: string;
  status: ListingStatus;
  claimState: string;
  isCanonical: boolean;
  isFeatured: boolean;
  isSponsored: boolean;
  placementStatus: string;
  placementId: string;
}

export async function listingsForTenant(tenantId: string, statusFilter?: ListingStatus[]): Promise<AdminListingRow[]> {
  return withTenant(tenantId, (tx) =>
    tx.$queryRaw<AdminListingRow[]>(Prisma.sql`
      SELECT b.id, b.trading_name AS "tradingName", b.slug, b.status, b.claim_state AS "claimState",
             dp.id AS "placementId", dp.is_canonical AS "isCanonical", dp.is_featured AS "isFeatured",
             dp.is_sponsored AS "isSponsored", dp.status AS "placementStatus"
      FROM directory_placements dp
      JOIN businesses b ON b.id = dp.subject_id AND dp.subject = 'BUSINESS'
      WHERE dp.tenant_id = ${tenantId}::uuid
        AND b.deleted_at IS NULL
        ${statusFilter?.length ? Prisma.sql`AND b.status IN (${Prisma.join(statusFilter)})` : Prisma.empty}
      ORDER BY b.status, b.trading_name
    `)
  );
}

export interface AdminResult {
  ok: boolean;
  error?: string;
}

export async function setListingStatus(
  ctx: AuditContext,
  businessId: string,
  newStatus: ListingStatus
): Promise<AdminResult> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return { ok: false, error: "Business not found" };

  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: businessId }, data: { status: newStatus } });
    // Resolve any pending edit-review report once the listing is re-approved.
    if (newStatus === "ACTIVE") {
      await tx.moderationReport.updateMany({
        where: { subject: "BUSINESS", subjectId: businessId, reason: "edit_review", status: "PENDING" },
        data: { status: "APPROVED", resolvedBy: ctx.actorUserId, resolvedAt: new Date() },
      });
    }
    await writeAudit(
      ctx,
      {
        action: `listing.${newStatus === "ACTIVE" ? "approved" : newStatus.toLowerCase()}`,
        subject: "business",
        subjectId: businessId,
        before: { status: business.status },
        after: { status: newStatus },
      },
      tx
    );
  });
  return { ok: true };
}

export async function resolveModerationReport(
  ctx: AuditContext,
  reportId: string,
  decision: "approve" | "dismiss"
): Promise<AdminResult> {
  const report = await prisma.moderationReport.findUnique({ where: { id: reportId } });
  if (!report || report.status !== "PENDING") return { ok: false, error: "Report not found or already resolved" };

  // Approving an edit-review re-activates the held listing; other report
  // types (closed_down, spam, suggested_edit) just close the report — acting
  // on the listing is a separate explicit decision.
  if (decision === "approve" && report.reason === "edit_review") {
    await setListingStatus(ctx, report.subjectId, "ACTIVE");
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.moderationReport.update({
      where: { id: reportId },
      data: {
        status: decision === "approve" ? "APPROVED" : "REJECTED",
        resolvedBy: ctx.actorUserId,
        resolvedAt: new Date(),
      },
    });
    await writeAudit(
      ctx,
      { action: `moderation.${decision}`, subject: report.subject.toLowerCase(), subjectId: report.subjectId, after: { reportId, reason: report.reason } },
      tx
    );
  });
  return { ok: true };
}

// ── Placement flags (RLS-scoped) ─────────────────────────────
export async function setPlacementFlags(
  ctx: AuditContext,
  tenantId: string,
  placementId: string,
  flags: { isFeatured?: boolean; isSponsored?: boolean; approve?: boolean }
): Promise<AdminResult> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; is_featured: boolean; is_sponsored: boolean; status: string }[]>(
      Prisma.sql`SELECT id, is_featured, is_sponsored, status FROM directory_placements WHERE id = ${placementId}::uuid`
    );
    const before = rows[0];
    if (!before) return { ok: false, error: "Placement not found on this tenant" };

    const data: Prisma.Sql[] = [];
    if (flags.isFeatured !== undefined) data.push(Prisma.sql`is_featured = ${flags.isFeatured}`);
    if (flags.isSponsored !== undefined) data.push(Prisma.sql`is_sponsored = ${flags.isSponsored}`);
    if (flags.approve) data.push(Prisma.sql`status = 'APPROVED', reviewed_by = ${ctx.actorUserId}::uuid, reviewed_at = now()`);
    if (data.length === 0) return { ok: true };

    await tx.$executeRaw(Prisma.sql`UPDATE directory_placements SET ${Prisma.join(data, ", ")} WHERE id = ${placementId}::uuid`);
    await writeAudit(
      { ...ctx, tenantId },
      {
        action: "placement.updated",
        subject: "placement",
        subjectId: placementId,
        before: { isFeatured: before.is_featured, isSponsored: before.is_sponsored, status: before.status },
        after: flags,
      },
      tx
    );
    return { ok: true };
  });
}

// ── Review moderation ────────────────────────────────────────
export interface PendingReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
  provider: string;
  createdAt: Date;
  businessId: string;
  businessName: string;
  businessSlug: string;
}

export async function pendingReviews(tenantId: string): Promise<PendingReviewRow[]> {
  return prisma.$queryRaw<PendingReviewRow[]>(Prisma.sql`
    SELECT r.id, r.rating, r.title, r.body, r.author_name AS "authorName", r.provider,
           r.created_at AS "createdAt",
           b.id AS "businessId", b.trading_name AS "businessName", b.slug AS "businessSlug"
    FROM reviews r
    JOIN businesses b ON b.id = r.business_id
    WHERE r.moderation_state = 'PENDING'
      AND canonical_tenant_for_subject('BUSINESS'::"PlacementSubject", b.id) = ${tenantId}::uuid
    ORDER BY r.created_at ASC
  `);
}

export async function moderateReview(
  ctx: AuditContext,
  reviewId: string,
  decision: "approve" | "reject" | "hide"
): Promise<AdminResult> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return { ok: false, error: "Review not found" };
  const state = decision === "approve" ? "APPROVED" : decision === "reject" ? "REJECTED" : "HIDDEN";

  await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id: reviewId }, data: { moderationState: state } });
    await writeAudit(
      ctx,
      { action: `review.${decision}`, subject: "review", subjectId: reviewId, before: { state: review.moderationState }, after: { state } },
      tx
    );
  });
  return { ok: true };
}

// ── Users (for impersonation start) ──────────────────────────
export interface AdminUserRow {
  id: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
}

export async function searchUsers(query: string, limit = 20): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({
    where: query ? { email: { contains: query, mode: "insensitive" } } : {},
    include: { roles: { include: { role: true } } },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt != null,
    roles: u.roles.map((r) => r.role.key),
  }));
}
