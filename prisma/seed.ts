// Slice 3 seed: taxonomy, UK place hierarchy, demo tenants and demo listings.
//
// Runs as the superuser (DIRECT_URL) because directory_placements carries a
// row-level security policy and this script writes across every tenant in
// one pass — the request-scoped `lih_app` role is deliberately not allowed
// to do that. See lib/tenant.ts for the per-request pattern the app itself
// uses instead.
//
// Every business/review/tenant created here is demo data for local testing,
// flagged via sourceKind = "demo_seed".

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function setPoint(id: string, lat: number, lng: number) {
  await prisma.$executeRaw`
    UPDATE business_locations SET point = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    WHERE id = ${id}::uuid`;
}

async function setCentroid(id: string, lat: number, lng: number) {
  await prisma.$executeRaw`
    UPDATE places SET centroid = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    WHERE id = ${id}::uuid`;
}

const BRAND_DEFAULTS = {
  colorPrimary: "#9B7F58",
  colorInk: "#302B27",
  colorSurface: "#FBF8F3",
  fontHeading: "Fraunces",
  fontBody: "Inter",
};

async function main() {
  // ── Roles & permissions (catalogue only — login ships in Slice 2) ──────
  const roleDefs: { key: string; label: string; scope: "PLATFORM" | "TENANT" | "BUSINESS" }[] = [
    { key: "super_admin", label: "Super Admin", scope: "PLATFORM" },
    { key: "tenant_admin", label: "Tenant Admin", scope: "TENANT" },
    { key: "editor", label: "Editor", scope: "TENANT" },
    { key: "moderator", label: "Moderator", scope: "TENANT" },
    { key: "sales", label: "Sales", scope: "PLATFORM" },
    { key: "support", label: "Support", scope: "PLATFORM" },
    { key: "analyst", label: "Analyst", scope: "PLATFORM" },
    { key: "business_owner", label: "Business Owner", scope: "BUSINESS" },
  ];
  for (const r of roleDefs) {
    await prisma.role.upsert({ where: { key: r.key }, update: {}, create: r });
  }

  const permissionDefs = [
    { key: "listings.approve", label: "Approve listings and edits" },
    { key: "reviews.moderate", label: "Moderate reviews" },
    { key: "billing.refund", label: "Issue refunds" },
    { key: "users.impersonate", label: "Impersonate a user (audited)" },
    { key: "tenants.manage", label: "Create and configure tenants" },
  ];
  for (const p of permissionDefs) {
    await prisma.permission.upsert({ where: { key: p.key }, update: {}, create: p });
  }
  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  for (const p of permissionDefs) {
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: p.key } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdmin.id, permissionId: perm.id } },
      update: {},
      create: { roleId: superAdmin.id, permissionId: perm.id },
    });
  }

  // ── Categories (the 20 from the master spec) ────────────────────────────
  const categoryDefs: { slug: string; name: string; schemaType: string }[] = [
    { slug: "trades", name: "Trades", schemaType: "LocalBusiness" },
    { slug: "pet-services", name: "Pet Services", schemaType: "LocalBusiness" },
    { slug: "health-wellness", name: "Health & Wellness", schemaType: "HealthAndBeautyBusiness" },
    { slug: "gyms-fitness", name: "Gyms & Fitness", schemaType: "ExerciseGym" },
    { slug: "automotive", name: "Automotive", schemaType: "AutomotiveBusiness" },
    { slug: "cafes", name: "Cafés", schemaType: "CafeOrCoffeeShop" },
    { slug: "restaurants", name: "Restaurants", schemaType: "Restaurant" },
    { slug: "opticians", name: "Opticians", schemaType: "Optician" },
    { slug: "dentists", name: "Dentists", schemaType: "Dentist" },
    { slug: "hair-barbers", name: "Hair & Barbers", schemaType: "HairSalon" },
    { slug: "beauty", name: "Beauty", schemaType: "BeautySalon" },
    { slug: "accountants", name: "Accountants", schemaType: "AccountingService" },
    { slug: "solicitors", name: "Solicitors", schemaType: "LegalService" },
    { slug: "mortgage-brokers", name: "Mortgage Brokers", schemaType: "FinancialService" },
    { slug: "estate-agents", name: "Estate Agents", schemaType: "RealEstateAgent" },
    { slug: "roofers", name: "Roofers", schemaType: "RoofingContractor" },
    { slug: "electricians", name: "Electricians", schemaType: "Electrician" },
    { slug: "plumbers", name: "Plumbers", schemaType: "Plumber" },
    { slug: "home-services", name: "Home Services", schemaType: "HomeAndConstructionBusiness" },
    { slug: "builders", name: "Builders", schemaType: "GeneralContractor" },
  ];
  const categories: Record<string, { id: string }> = {};
  for (const [i, c] of categoryDefs.entries()) {
    categories[c.slug] = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, sortOrder: i },
    });
  }

  const attributeDefs: {
    key: string;
    label: string;
    type: "BOOLEAN" | "ENUM";
    options?: string[];
    categories: string[];
  }[] = [
    { key: "wheelchair_access", label: "Wheelchair accessible", type: "BOOLEAN", categories: Object.keys(categories) },
    { key: "offers_delivery", label: "Offers delivery", type: "BOOLEAN", categories: ["cafes", "restaurants"] },
    {
      key: "price_band",
      label: "Price band",
      type: "ENUM",
      options: ["£", "££", "£££"],
      categories: ["restaurants", "cafes", "beauty", "hair-barbers"],
    },
    {
      key: "emergency_callout",
      label: "Emergency call-out available",
      type: "BOOLEAN",
      categories: ["electricians", "plumbers", "roofers", "home-services", "trades"],
    },
  ];
  for (const a of attributeDefs) {
    const attr = await prisma.attribute.upsert({
      where: { key: a.key },
      update: {},
      create: {
        key: a.key,
        label: a.label,
        type: a.type,
        options: a.options ?? undefined,
        isFilter: true,
      },
    });
    for (const catSlug of a.categories) {
      const cat = categories[catSlug];
      if (!cat) continue;
      await prisma.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId: cat.id, attributeId: attr.id } },
        update: {},
        create: { categoryId: cat.id, attributeId: attr.id },
      });
    }
  }

  // ── Places: UK → South East England → Hampshire → towns/cities ─────────
  async function upsertPlace(
    kind: "COUNTRY" | "REGION" | "COUNTY" | "CITY" | "TOWN",
    name: string,
    slug: string,
    parentId: string | null
  ) {
    const existing = await prisma.place.findFirst({ where: { slug, parentId } });
    if (existing) return existing;
    return prisma.place.create({ data: { kind, name, slug, parentId } });
  }

  const uk = await upsertPlace("COUNTRY", "United Kingdom", "united-kingdom", null);
  const southEast = await upsertPlace("REGION", "South East England", "south-east-england", uk.id);
  const hampshire = await upsertPlace("COUNTY", "Hampshire", "hampshire", southEast.id);
  await setCentroid(hampshire.id, 51.05, -1.31);

  const towns = {
    winchester: await upsertPlace("TOWN", "Winchester", "winchester", hampshire.id),
    basingstoke: await upsertPlace("TOWN", "Basingstoke", "basingstoke", hampshire.id),
    alton: await upsertPlace("TOWN", "Alton", "alton", hampshire.id),
    fareham: await upsertPlace("TOWN", "Fareham", "fareham", hampshire.id),
    southampton: await upsertPlace("CITY", "Southampton", "southampton", hampshire.id),
    portsmouth: await upsertPlace("CITY", "Portsmouth", "portsmouth", hampshire.id),
  };
  const coords: Record<keyof typeof towns, [number, number]> = {
    winchester: [51.0632, -1.308],
    basingstoke: [51.2668, -1.0876],
    alton: [51.1489, -0.9727],
    fareham: [50.8523, -1.1785],
    southampton: [50.9097, -1.4044],
    portsmouth: [50.8058, -1.0872],
  };
  for (const [key, place] of Object.entries(towns)) {
    const [lat, lng] = coords[key as keyof typeof towns];
    await setCentroid(place.id, lat, lng);
  }

  // ── Tenants ──────────────────────────────────────────────────────────────
  async function upsertTenant(input: {
    slug: string;
    name: string;
    kind: "GEOGRAPHIC" | "NICHE" | "HYBRID";
    hostname: string;
    coveragePlaceIds?: string[];
    coverageCategoryIds?: string[];
    positioningBadge: string;
  }) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: input.slug },
      update: {
        coveragePlaceIds: input.coveragePlaceIds ?? [],
        coverageCategoryIds: input.coverageCategoryIds ?? [],
      },
      create: {
        slug: input.slug,
        name: input.name,
        kind: input.kind,
        status: "ACTIVE",
        coveragePlaceIds: input.coveragePlaceIds ?? [],
        coverageCategoryIds: input.coverageCategoryIds ?? [],
      },
    });
    await prisma.tenantBranding.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: { tenantId: tenant.id, ...BRAND_DEFAULTS, positioningBadge: input.positioningBadge },
    });
    await prisma.tenantDomain.upsert({
      where: { hostname: input.hostname },
      update: { tenantId: tenant.id, verifiedAt: new Date(), isPrimary: true },
      create: { tenantId: tenant.id, hostname: input.hostname, isPrimary: true, verifiedAt: new Date() },
    });
    return tenant;
  }

  const hub = await upsertTenant({
    slug: "hub",
    name: "Local Initiative Hub",
    kind: "GEOGRAPHIC",
    hostname: "hub.local-initiative.test",
    coveragePlaceIds: [uk.id],
    positioningBadge: "The UK-wide Local Initiative directory",
  });

  const hampshireTenant = await upsertTenant({
    slug: "hampshire",
    name: "Hampshire Local Initiative",
    kind: "GEOGRAPHIC",
    hostname: "hampshire.local-initiative.test",
    coveragePlaceIds: [hampshire.id],
    positioningBadge: "Trusted local businesses across Hampshire",
  });

  const tradesCategorySlugs = ["roofers", "electricians", "plumbers", "builders", "home-services", "trades"];
  const homeServicesTenant = await upsertTenant({
    slug: "home-services",
    name: "Home Services Initiative",
    kind: "NICHE",
    hostname: "homeservices.local-initiative.test",
    coverageCategoryIds: tradesCategorySlugs.map((s) => categories[s]!.id),
    positioningBadge: "Vetted tradespeople for your home",
  });

  // ── Plan templates (platform-wide; tenantId null) ───────────────────────
  const planDefs: {
    key: string;
    name: string;
    priceMinorMonthly: number;
    isEnquiryOnly?: boolean;
    features: { featureKey: string; valueType: "BOOLEAN" | "LIMIT"; boolValue?: boolean; limitValue?: number }[];
  }[] = [
    {
      key: "free",
      name: "Free Listing",
      priceMinorMonthly: 0,
      features: [
        { featureKey: "images.max", valueType: "LIMIT", limitValue: 3 },
        { featureKey: "categories.max", valueType: "LIMIT", limitValue: 1 },
        { featureKey: "offers.create", valueType: "BOOLEAN", boolValue: false },
        { featureKey: "featured.placement", valueType: "BOOLEAN", boolValue: false },
      ],
    },
    {
      key: "enhanced",
      name: "Enhanced / Visibility",
      priceMinorMonthly: 2900,
      features: [
        { featureKey: "images.max", valueType: "LIMIT", limitValue: 10 },
        { featureKey: "categories.max", valueType: "LIMIT", limitValue: 3 },
        { featureKey: "offers.create", valueType: "BOOLEAN", boolValue: true },
        { featureKey: "offers.monthly_limit", valueType: "LIMIT", limitValue: 2 },
        { featureKey: "featured.placement", valueType: "BOOLEAN", boolValue: false },
      ],
    },
    {
      key: "premium",
      name: "Premium / Growth",
      priceMinorMonthly: 7900,
      features: [
        { featureKey: "images.max", valueType: "LIMIT", limitValue: 30 },
        { featureKey: "categories.max", valueType: "LIMIT", limitValue: 5 },
        { featureKey: "offers.create", valueType: "BOOLEAN", boolValue: true },
        { featureKey: "offers.monthly_limit", valueType: "LIMIT", limitValue: 10 },
        { featureKey: "featured.placement", valueType: "BOOLEAN", boolValue: true },
        { featureKey: "ghl.automation", valueType: "BOOLEAN", boolValue: true },
      ],
    },
    {
      key: "marketing",
      name: "Marketing / Local Digital Spark",
      priceMinorMonthly: 0,
      isEnquiryOnly: true,
      features: [{ featureKey: "managed_services", valueType: "BOOLEAN", boolValue: true }],
    },
  ];
  for (const [i, p] of planDefs.entries()) {
    let plan = await prisma.plan.findFirst({ where: { tenantId: null, key: p.key } });
    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          key: p.key,
          name: p.name,
          priceMinorMonthly: p.priceMinorMonthly,
          isEnquiryOnly: p.isEnquiryOnly ?? false,
          sortOrder: i,
        },
      });
    }
    for (const f of p.features) {
      await prisma.planFeature.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey: f.featureKey } },
        update: {},
        create: { planId: plan.id, ...f },
      });
    }
  }

  // ── Demo businesses ──────────────────────────────────────────────────────
  type DemoBusiness = {
    slug: string;
    tradingName: string;
    summary: string;
    categorySlugs: string[];
    town: keyof typeof towns;
    verified?: boolean;
    postcode: string;
    addressLine1: string;
  };
  const demoBusinesses: DemoBusiness[] = [
    {
      slug: "winchester-warm-plumbing",
      tradingName: "Winchester Warm Plumbing",
      summary: "Family-run plumbing and heating, serving Winchester for 20 years.",
      categorySlugs: ["plumbers", "home-services"],
      town: "winchester",
      verified: true,
      postcode: "SO23 9BH",
      addressLine1: "12 Jewry Street",
    },
    {
      slug: "solent-sparks-electrical",
      tradingName: "Solent Sparks Electrical",
      summary: "NICEIC-registered electricians covering Southampton and the Solent.",
      categorySlugs: ["electricians", "home-services"],
      town: "southampton",
      verified: true,
      postcode: "SO14 3FE",
      addressLine1: "45 Above Bar Street",
    },
    {
      slug: "fareham-roofline-roofing",
      tradingName: "Fareham Roofline Roofing",
      summary: "Pitched and flat roofing, repairs and emergency call-outs.",
      categorySlugs: ["roofers"],
      town: "fareham",
      postcode: "PO16 0PQ",
      addressLine1: "3 West Street",
    },
    {
      slug: "alton-oak-builders",
      tradingName: "Alton Oak Builders",
      summary: "Extensions, renovations and new builds across East Hampshire.",
      categorySlugs: ["builders", "home-services"],
      town: "alton",
      postcode: "GU34 1BW",
      addressLine1: "8 High Street",
    },
    {
      slug: "the-basingstoke-bakehouse",
      tradingName: "The Basingstoke Bakehouse",
      summary: "Independent café serving locally roasted coffee and fresh bakes.",
      categorySlugs: ["cafes"],
      town: "basingstoke",
      verified: true,
      postcode: "RG21 7LX",
      addressLine1: "22 New Street",
    },
    {
      slug: "portsmouth-harbour-dental",
      tradingName: "Portsmouth Harbour Dental",
      summary: "Family and cosmetic dentistry with same-week appointments.",
      categorySlugs: ["dentists", "health-wellness"],
      town: "portsmouth",
      verified: true,
      postcode: "PO1 2EG",
      addressLine1: "5 Gunwharf Quays",
    },
    {
      slug: "winchester-strong-fitness",
      tradingName: "Winchester Strong Fitness",
      summary: "Independent gym with personal training and small group classes.",
      categorySlugs: ["gyms-fitness"],
      town: "winchester",
      postcode: "SO22 5DW",
      addressLine1: "17 Stockbridge Road",
    },
    {
      slug: "hampshire-clear-optics",
      tradingName: "Hampshire Clear Optics",
      summary: "Independent opticians offering eye tests and designer eyewear.",
      categorySlugs: ["opticians"],
      town: "basingstoke",
      postcode: "RG21 7QN",
      addressLine1: "31 Church Street",
    },
  ];

  const dayHours = (day: number) =>
    day === 0
      ? { dayOfWeek: 0, opensAt: "00:00", closesAt: "00:00", isClosed: true }
      : day === 6
        ? { dayOfWeek: 6, opensAt: "09:00", closesAt: "13:00", isClosed: false }
        : { dayOfWeek: day, opensAt: "09:00", closesAt: "17:30", isClosed: false };

  for (const b of demoBusinesses) {
    const business = await prisma.business.upsert({
      where: { slug: b.slug },
      update: {},
      create: {
        slug: b.slug,
        tradingName: b.tradingName,
        summary: b.summary,
        description: `${b.tradingName} is a demo listing seeded for local development. ${b.summary}`,
        websiteUrl: `https://example.com/${b.slug}`,
        status: "ACTIVE",
        claimState: b.verified ? "CLAIMED" : "UNCLAIMED",
        verifiedAt: b.verified ? new Date() : null,
        sourceKind: "demo_seed",
      },
    });

    const town = towns[b.town];
    const [lat, lng] = coords[b.town];

    let location = await prisma.businessLocation.findFirst({
      where: { businessId: business.id, isPrimary: true },
    });
    if (!location) {
      location = await prisma.businessLocation.create({
        data: {
          businessId: business.id,
          isPrimary: true,
          addressLine1: b.addressLine1,
          locality: town.name,
          postcode: b.postcode,
          countryCode: "GB",
          placeId: town.id,
          phone: "01962 000000",
          email: `hello@${b.slug.replace(/-/g, "")}.example.com`,
        },
      });
    }
    await setPoint(location.id, lat, lng);

    for (let day = 0; day <= 6; day++) {
      const existingHours = await prisma.openingHour.findFirst({
        where: { locationId: location.id, dayOfWeek: day },
      });
      if (!existingHours) {
        await prisma.openingHour.create({ data: { locationId: location.id, ...dayHours(day) } });
      }
    }

    for (const [i, catSlug] of b.categorySlugs.entries()) {
      const cat = categories[catSlug];
      if (!cat) continue;
      await prisma.businessCategory.upsert({
        where: { businessId_categoryId: { businessId: business.id, categoryId: cat.id } },
        update: {},
        create: { businessId: business.id, categoryId: cat.id, isPrimary: i === 0 },
      });
    }

    // Canonical placement: the tenant this business "lives on".
    await prisma.directoryPlacement.upsert({
      where: { tenantId_subject_subjectId: { tenantId: hampshireTenant.id, subject: "BUSINESS", subjectId: business.id } },
      update: {},
      create: {
        tenantId: hampshireTenant.id,
        subject: "BUSINESS",
        subjectId: business.id,
        status: "APPROVED",
        isCanonical: true,
        reviewedAt: new Date(),
      },
    });
    // Syndicated to the UK-wide hub — same record, no duplicate profile.
    await prisma.directoryPlacement.upsert({
      where: { tenantId_subject_subjectId: { tenantId: hub.id, subject: "BUSINESS", subjectId: business.id } },
      update: {},
      create: {
        tenantId: hub.id,
        subject: "BUSINESS",
        subjectId: business.id,
        status: "APPROVED",
        isCanonical: false,
        reviewedAt: new Date(),
      },
    });
    // Syndicated to the niche tenant when the trade matches its coverage.
    if (b.categorySlugs.some((s) => tradesCategorySlugs.includes(s))) {
      await prisma.directoryPlacement.upsert({
        where: {
          tenantId_subject_subjectId: { tenantId: homeServicesTenant.id, subject: "BUSINESS", subjectId: business.id },
        },
        update: {},
        create: {
          tenantId: homeServicesTenant.id,
          subject: "BUSINESS",
          subjectId: business.id,
          status: "APPROVED",
          isCanonical: false,
          reviewedAt: new Date(),
        },
      });
    }

    if (b.verified) {
      const existingReviews = await prisma.review.count({ where: { businessId: business.id } });
      if (existingReviews === 0) {
        await prisma.review.create({
          data: {
            businessId: business.id,
            provider: "FIRST_PARTY",
            rating: 5,
            title: "Excellent service",
            body: "Demo review seeded for local testing — turned up on time and did a great job.",
            authorName: "Demo Reviewer",
            reviewedAt: new Date(),
            moderationState: "APPROVED",
          },
        });
        await prisma.review.create({
          data: {
            businessId: business.id,
            provider: "FIRST_PARTY",
            rating: 4,
            title: "Would recommend",
            body: "Demo review seeded for local testing — good value, friendly team.",
            authorName: "Another Demo Reviewer",
            reviewedAt: new Date(),
            moderationState: "APPROVED",
          },
        });
      }
    }
  }

  console.log("Seed complete.");
  console.log(`Tenants: ${hub.name} / ${hampshireTenant.name} / ${homeServicesTenant.name}`);
  console.log(`Categories: ${Object.keys(categories).length}, Businesses: ${demoBusinesses.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
