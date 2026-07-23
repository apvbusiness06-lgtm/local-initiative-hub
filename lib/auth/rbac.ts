// The single authorization gate. Every protected route/action calls
// can(userId, permissionKey, subject) — never an inline `role === "admin"`
// check — so entitlement logic lives in one place and in the data
// (UserRoleAssignment / Role / RolePermission), not scattered across
// route handlers.
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export interface PermissionSubject {
  tenantId?: string;
  businessId?: string;
}

export async function can(
  userId: string,
  permissionKey: string,
  subject: PermissionSubject = {}
): Promise<boolean> {
  const scopeOr: Prisma.UserRoleAssignmentWhereInput[] = [{ role: { scope: "PLATFORM" } }];
  if (subject.tenantId) {
    scopeOr.push({ role: { scope: "TENANT" }, tenantId: subject.tenantId });
  }
  if (subject.businessId) {
    scopeOr.push({ role: { scope: "BUSINESS" }, businessId: subject.businessId });
  }

  const match = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { role: { permissions: { some: { permission: { key: permissionKey } } } } },
        { OR: scopeOr },
      ],
    },
  });
  return !!match;
}

/** MFA enrolment is mandatory for platform-scope roles (Slice 2 brief). */
export async function hasPlatformRole(userId: string): Promise<boolean> {
  const match = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      role: { scope: "PLATFORM" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  return !!match;
}
