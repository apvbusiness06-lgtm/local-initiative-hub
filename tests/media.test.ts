// Slice 7 acceptance: an oversized or wrong-MIME upload is rejected
// SERVER-SIDE, not just client-side. These call the real upload path with
// deliberately malformed inputs and assert rejection before anything is
// stored. Uses a throwaway premium business (higher images.max) torn down
// after.
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { generateRawToken } from "@/lib/auth/tokens";
import { uploadGalleryImage } from "@/lib/media";

const prisma = new PrismaClient();

let businessId: string;
let premiumPlanId: string;

beforeAll(async () => {
  premiumPlanId = (await prisma.plan.findFirstOrThrow({ where: { tenantId: null, key: "premium" } })).id;
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  const business = await prisma.business.create({
    data: { slug: `media-test-${suffix}`, tradingName: `Media Test ${suffix}`, status: "ACTIVE", sourceKind: "test" },
  });
  businessId = business.id;
  await prisma.subscription.create({
    data: { businessId, planId: premiumPlanId, status: "ACTIVE" },
  });
});

afterEach(async () => {
  await prisma.mediaAsset.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
});

describe("uploadGalleryImage server-side validation", () => {
  it("rejects a non-image even when the declared MIME says image/png", async () => {
    const notAnImage = Buffer.from("this is definitely not a PNG, whatever the header claims");
    const result = await uploadGalleryImage(businessId, { buffer: notAnImage, declaredType: "image/png" }, "trick");
    expect(result.ok).toBe(false);
    expect(await prisma.mediaAsset.count({ where: { businessId } })).toBe(0);
  });

  it("rejects an oversized file before decoding", async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024, 1); // 9 MB > 8 MB cap
    const result = await uploadGalleryImage(businessId, { buffer: huge, declaredType: "image/jpeg" }, null);
    expect(result.ok).toBe(false);
  });

  it("accepts a real image, re-encodes to WebP and strips metadata", async () => {
    // A genuine 100x80 JPEG carrying EXIF metadata.
    const jpeg = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .withMetadata({ exif: { IFD0: { Copyright: "test" } } })
      .jpeg()
      .toBuffer();

    const result = await uploadGalleryImage(businessId, { buffer: jpeg, declaredType: "image/jpeg" }, "a blue square");
    expect(result.ok).toBe(true);

    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { businessId } });
    expect(asset.mimeType).toBe("image/webp");
    expect(asset.altText).toBe("a blue square");
    // stored bytes must decode as webp with no EXIF retained
    const stored = await sharp(asset.url.replace(/^\/media\//, process.env.MEDIA_LOCAL_DIR ? `${process.env.MEDIA_LOCAL_DIR}/` : `${process.cwd()}/storage/media/`)).metadata();
    expect(stored.format).toBe("webp");
    expect(stored.exif).toBeUndefined();
  });

  it("enforces the plan's images.max limit in the action layer", async () => {
    // premium images.max is 30 in the seed; drop to a tiny custom plan feel by
    // filling to the limit would be slow — instead assert the count guard by
    // temporarily lowering via a fresh free business.
    const suffix = generateRawToken().slice(0, 8).toLowerCase();
    const freeBiz = await prisma.business.create({
      data: { slug: `media-free-${suffix}`, tradingName: `Free ${suffix}`, status: "ACTIVE", sourceKind: "test" },
    });
    // free plan images.max = 3; add 3 dummy assets directly, then attempt a real upload.
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    for (let i = 0; i < 3; i++) {
      const r = await uploadGalleryImage(freeBiz.id, { buffer: jpeg, declaredType: "image/jpeg" }, null);
      expect(r.ok).toBe(true);
    }
    const overLimit = await uploadGalleryImage(freeBiz.id, { buffer: jpeg, declaredType: "image/jpeg" }, null);
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.error).toMatch(/plan allows up to 3/i);

    await prisma.mediaAsset.deleteMany({ where: { businessId: freeBiz.id } });
    await prisma.business.delete({ where: { id: freeBiz.id } });
  });
});
