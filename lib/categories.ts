import { PrismaClient } from "@prisma/client";
import type { ResolvedTenant } from "@/lib/tenant";

const prisma = new PrismaClient();

export interface CategorySummary {
  slug: string;
  name: string;
}

/**
 * Niche tenants scope the taxonomy to their coverage; geographic tenants
 * (empty coverageCategoryIds) see the full list. Categories themselves are
 * platform-wide data — this just decides which ones are relevant to show.
 */
export async function getTenantCategories(tenant: ResolvedTenant, limit?: number): Promise<CategorySummary[]> {
  const rows = await prisma.category.findMany({
    where: tenant.coverageCategoryIds.length ? { id: { in: tenant.coverageCategoryIds } } : {},
    orderBy: { sortOrder: "asc" },
    select: { slug: true, name: true },
    take: limit,
  });
  return rows;
}
