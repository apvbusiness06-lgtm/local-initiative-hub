// Central audit writer. Sensitive admin actions route through here so the
// before/after snapshot and — critically — the impersonation identity are
// recorded uniformly. When an action happens under support impersonation,
// the row carries BOTH the real actor and the impersonated user, which is
// the Slice 8 acceptance criterion.

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export interface AuditContext {
  actorUserId: string;
  // Set only when acting through impersonation.
  impersonatedUserId?: string | null;
  impersonationReason?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
}

export interface AuditEntry {
  action: string; // e.g. "listing.approved", "plan.changed"
  subject: string; // e.g. "business", "user"
  subjectId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

export async function writeAudit(
  ctx: AuditContext,
  entry: AuditEntry,
  tx: Prisma.TransactionClient | PrismaClient = prisma
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: ctx.actorUserId,
      impersonatedUserId: ctx.impersonatedUserId ?? null,
      impersonationReason: ctx.impersonationReason ?? null,
      tenantId: ctx.tenantId ?? null,
      action: entry.action,
      subject: entry.subject,
      subjectId: entry.subjectId ?? null,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
      ipAddress: ctx.ipAddress ?? null,
    },
  });
}
