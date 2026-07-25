// Server-side image validation + normalisation. The acceptance criterion is
// that an oversized or wrong-MIME upload is rejected SERVER-SIDE, not just by
// the browser — so we never trust the client's Content-Type or filename. We
// sniff the real format with sharp's decoder, cap dimensions and bytes, strip
// all metadata (EXIF can carry GPS location), and re-encode to WebP. A file
// that isn't a decodable raster image in an allowed format is rejected.

import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { PrismaClient, type MediaKind } from "@prisma/client";
import { getMediaStore } from "./storage";
import { featureLimit } from "./entitlements";

const prisma = new PrismaClient();

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB before decode
const MAX_DIMENSION = 4000; // reject decompression-bomb-shaped inputs
const OUTPUT_MAX_EDGE = 1600; // downscale large photos
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif"]);

export type UploadError =
  | { ok: false; error: string };
export type UploadOk = { ok: true; id: string; url: string };
export type UploadResult = UploadOk | UploadError;

interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

async function normaliseImage(input: Buffer): Promise<ProcessedImage | null> {
  if (input.byteLength > MAX_UPLOAD_BYTES) return null;

  let meta;
  try {
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    return null; // not a decodable image
  }
  if (!meta.format || !ALLOWED_INPUT_FORMATS.has(meta.format)) return null;
  if ((meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION) return null;
  if (!meta.width || !meta.height) return null;

  // Re-encode from scratch: this both compresses and drops all metadata
  // (no .withMetadata(), so EXIF/GPS/ICC beyond sRGB is gone).
  const pipeline = sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation before stripping it
    .resize({ width: OUTPUT_MAX_EDGE, height: OUTPUT_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Validate, normalise, store and record a gallery image for a business.
 * Enforces the plan's images.max limit in this action layer — a client that
 * bypasses the UI still can't exceed it. Caller must already have verified
 * the user owns the business.
 */
export async function uploadGalleryImage(
  businessId: string,
  file: { buffer: Buffer; declaredType: string },
  altText: string | null
): Promise<UploadResult> {
  const limit = (await featureLimit(businessId, "images.max")) ?? 0;
  const current = await prisma.mediaAsset.count({ where: { businessId, kind: "GALLERY" } });
  if (current >= limit) {
    return { ok: false, error: `Your plan allows up to ${limit} images. Remove one or upgrade to add more.` };
  }

  const processed = await normaliseImage(file.buffer);
  if (!processed) {
    return { ok: false, error: "That file isn't a supported image (JPEG, PNG, WebP, AVIF or GIF, up to 8 MB)." };
  }

  const key = `business/${businessId}/gallery/${randomUUID()}.webp`;
  const stored = await getMediaStore().put(key, processed.data, "image/webp");

  const asset = await prisma.mediaAsset.create({
    data: {
      businessId,
      kind: "GALLERY" as MediaKind,
      url: stored.url,
      altText: altText?.trim().slice(0, 300) || null,
      width: processed.width,
      height: processed.height,
      byteSize: processed.data.byteLength,
      mimeType: "image/webp",
      sortOrder: current,
    },
  });

  return { ok: true, id: asset.id, url: stored.url };
}

export async function deleteGalleryImage(businessId: string, assetId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, businessId, kind: "GALLERY" } });
  if (!asset) return;
  // url is "/media/<key>"; recover the storage key.
  const key = asset.url.replace(/^\/media\//, "");
  await getMediaStore().remove(key);
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
}
