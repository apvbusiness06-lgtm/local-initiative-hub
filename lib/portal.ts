// Slice 7 — business portal data + mutations. Access is owner-gated
// (BusinessOwner, via lib/claims.ts::userOwnsBusiness); every mutation here
// re-checks ownership so a forged businessId in a form can't edit someone
// else's listing. Entitlement limits (categories.max) are enforced HERE in
// the action layer, never only in the UI.
//
// Moderation routing: edits to low-risk operational fields (hours, phone,
// services) publish immediately. Edits to high-risk public-identity fields
// (trading name, description) are held: the business drops to NEEDS_CHANGES
// and a ModerationReport is filed, so the change reaches the public page only
// after an admin approves it (Slice 8 acts on the queue).

import { PrismaClient } from "@prisma/client";
import { userOwnsBusiness } from "./claims";
import { featureLimit } from "./entitlements";

const prisma = new PrismaClient();

export interface OwnedBusinessSummary {
  id: string;
  slug: string;
  tradingName: string;
  status: string;
  claimState: string;
}

export async function getOwnedBusinesses(userId: string): Promise<OwnedBusinessSummary[]> {
  const owned = await prisma.businessOwner.findMany({
    where: { userId },
    include: { business: true },
    orderBy: { grantedAt: "desc" },
  });
  return owned
    .filter((o) => !o.business.deletedAt)
    .map((o) => ({
      id: o.business.id,
      slug: o.business.slug,
      tradingName: o.business.tradingName,
      status: o.business.status,
      claimState: o.business.claimState,
    }));
}

export interface PortalBusiness {
  id: string;
  slug: string;
  tradingName: string;
  summary: string | null;
  description: string | null;
  websiteUrl: string | null;
  status: string;
  location: {
    id: string;
    addressLine1: string | null;
    addressLine2: string | null;
    locality: string | null;
    postcode: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  categories: { slug: string; name: string; isPrimary: boolean }[];
  allCategories: { slug: string; name: string }[];
  services: {
    id: string;
    name: string;
    description: string | null;
    priceMinor: number | null;
    isFromPrice: boolean;
  }[];
  gallery: { id: string; url: string; altText: string | null }[];
  openingHours: { dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }[];
  imagesLimit: number;
  categoriesLimit: number;
  pendingModeration: boolean;
}

export async function getPortalBusiness(userId: string, businessId: string): Promise<PortalBusiness | null> {
  if (!(await userOwnsBusiness(userId, businessId))) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      locations: { where: { isPrimary: true }, take: 1 },
      categories: { include: { category: true } },
      services: { orderBy: { sortOrder: "asc" } },
      media: { where: { kind: "GALLERY" }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!business || business.deletedAt) return null;

  const location = business.locations[0] ?? null;
  const [allCategories, hours, imagesLimit, categoriesLimit, pendingReport] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
    location
      ? prisma.openingHour.findMany({ where: { locationId: location.id }, orderBy: { dayOfWeek: "asc" } })
      : Promise.resolve([]),
    featureLimit(businessId, "images.max"),
    featureLimit(businessId, "categories.max"),
    prisma.moderationReport.findFirst({
      where: { subject: "BUSINESS", subjectId: businessId, reason: "edit_review", status: "PENDING" },
    }),
  ]);

  return {
    id: business.id,
    slug: business.slug,
    tradingName: business.tradingName,
    summary: business.summary,
    description: business.description,
    websiteUrl: business.websiteUrl,
    status: business.status,
    location: location
      ? {
          id: location.id,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          locality: location.locality,
          postcode: location.postcode,
          phone: location.phone,
          email: location.email,
        }
      : null,
    categories: business.categories.map((c) => ({ slug: c.category.slug, name: c.category.name, isPrimary: c.isPrimary })),
    allCategories,
    services: business.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceMinor: s.priceMinor,
      isFromPrice: s.isFromPrice,
    })),
    gallery: business.media.map((m) => ({ id: m.id, url: m.url, altText: m.altText })),
    openingHours: hours.map((h) => ({ dayOfWeek: h.dayOfWeek, opensAt: h.opensAt, closesAt: h.closesAt, isClosed: h.isClosed })),
    imagesLimit: imagesLimit ?? 0,
    categoriesLimit: categoriesLimit ?? 1,
    pendingModeration: !!pendingReport,
  };
}

export interface ProfileEdit {
  tradingName: string;
  summary: string;
  description: string;
  websiteUrl: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  postcode: string;
}

export interface SaveResult {
  ok: boolean;
  moderationHeld?: boolean;
  error?: string;
}

const URL_RE = /^https?:\/\/.+/i;

/**
 * Save profile edits. High-risk identity fields (trading name, description)
 * route to moderation; operational fields apply immediately. Returns
 * moderationHeld=true when the identity change is awaiting review.
 */
export async function saveProfile(userId: string, businessId: string, edit: ProfileEdit): Promise<SaveResult> {
  if (!(await userOwnsBusiness(userId, businessId))) return { ok: false, error: "Not authorised" };

  const tradingName = edit.tradingName.trim().slice(0, 200);
  if (!tradingName) return { ok: false, error: "Business name is required" };
  const websiteUrl = edit.websiteUrl.trim();
  if (websiteUrl && !URL_RE.test(websiteUrl)) return { ok: false, error: "Website must start with http:// or https://" };

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });

  const identityChanged =
    tradingName !== business.tradingName || edit.description.trim() !== (business.description ?? "").trim();

  await prisma.$transaction(async (tx) => {
    // Operational + low-risk fields always apply.
    await tx.business.update({
      where: { id: businessId },
      data: {
        summary: edit.summary.trim().slice(0, 280) || null,
        websiteUrl: websiteUrl || null,
        // Identity fields apply immediately too, but the listing is flagged
        // NEEDS_CHANGES so it's re-reviewed; the public search query only
        // shows ACTIVE, so a held listing drops out until re-approved.
        ...(identityChanged
          ? { tradingName, description: edit.description.trim() || null, status: "NEEDS_CHANGES" }
          : {}),
      },
    });

    const location = business.locations[0];
    if (location) {
      await tx.businessLocation.update({
        where: { id: location.id },
        data: {
          phone: edit.phone.trim() || null,
          email: edit.email.trim().toLowerCase() || null,
          addressLine1: edit.addressLine1.trim() || null,
          addressLine2: edit.addressLine2.trim() || null,
          locality: edit.locality.trim() || null,
          postcode: edit.postcode.trim() || null,
        },
      });
    }

    if (identityChanged) {
      const existing = await tx.moderationReport.findFirst({
        where: { subject: "BUSINESS", subjectId: businessId, reason: "edit_review", status: "PENDING" },
      });
      if (!existing) {
        await tx.moderationReport.create({
          data: {
            subject: "BUSINESS",
            subjectId: businessId,
            reporterUserId: userId,
            reason: "edit_review",
            detail: "Owner edited public identity fields (name/description); awaiting re-approval.",
          },
        });
      }
    }
  });

  return { ok: true, moderationHeld: identityChanged };
}

/** Set the business's categories, enforcing the plan's categories.max limit. */
export async function saveCategories(userId: string, businessId: string, slugs: string[]): Promise<SaveResult> {
  if (!(await userOwnsBusiness(userId, businessId))) return { ok: false, error: "Not authorised" };

  const limit = (await featureLimit(businessId, "categories.max")) ?? 1;
  const chosen = [...new Set(slugs)].slice(0, limit + 1); // detect overflow
  if (chosen.length > limit) {
    return { ok: false, error: `Your plan allows up to ${limit} ${limit === 1 ? "category" : "categories"}.` };
  }
  if (chosen.length === 0) return { ok: false, error: "Choose at least one category." };

  const categories = await prisma.category.findMany({ where: { slug: { in: chosen } }, select: { id: true, slug: true } });

  await prisma.$transaction(async (tx) => {
    await tx.businessCategory.deleteMany({ where: { businessId } });
    await tx.businessCategory.createMany({
      data: categories.map((c, i) => ({ businessId, categoryId: c.id, isPrimary: i === 0 })),
    });
  });
  return { ok: true };
}

export async function saveOpeningHours(
  userId: string,
  businessId: string,
  hours: { dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }[]
): Promise<SaveResult> {
  if (!(await userOwnsBusiness(userId, businessId))) return { ok: false, error: "Not authorised" };
  const location = await prisma.businessLocation.findFirst({ where: { businessId, isPrimary: true } });
  if (!location) return { ok: false, error: "No primary location to set hours on." };

  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const h of hours) {
    if (!h.isClosed && (!HHMM.test(h.opensAt) || !HHMM.test(h.closesAt) || h.opensAt >= h.closesAt)) {
      return { ok: false, error: "Opening times must be valid and open before close." };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.openingHour.deleteMany({ where: { locationId: location.id } });
    await tx.openingHour.createMany({
      data: hours.map((h) => ({
        locationId: location.id,
        dayOfWeek: h.dayOfWeek,
        opensAt: h.isClosed ? "00:00" : h.opensAt,
        closesAt: h.isClosed ? "00:00" : h.closesAt,
        isClosed: h.isClosed,
      })),
    });
  });
  return { ok: true };
}

export async function addService(
  userId: string,
  businessId: string,
  input: { name: string; description: string; priceMinor: number | null; isFromPrice: boolean }
): Promise<SaveResult> {
  if (!(await userOwnsBusiness(userId, businessId))) return { ok: false, error: "Not authorised" };
  const name = input.name.trim().slice(0, 200);
  if (!name) return { ok: false, error: "Service name is required." };
  const count = await prisma.serviceProduct.count({ where: { businessId } });
  await prisma.serviceProduct.create({
    data: {
      businessId,
      name,
      description: input.description.trim().slice(0, 1000) || null,
      priceMinor: input.priceMinor,
      isFromPrice: input.isFromPrice,
      sortOrder: count,
    },
  });
  return { ok: true };
}

export async function deleteService(userId: string, businessId: string, serviceId: string): Promise<SaveResult> {
  if (!(await userOwnsBusiness(userId, businessId))) return { ok: false, error: "Not authorised" };
  await prisma.serviceProduct.deleteMany({ where: { id: serviceId, businessId } });
  return { ok: true };
}
