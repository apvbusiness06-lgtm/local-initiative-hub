// ContentItem carries no tenantId — editorial content is platform-wide data,
// same pattern as categories.ts. A minimal read path only: no revisions, no
// scheduling UI, no newsletter tie-in — that's the real Slice 13.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface ContentSummary {
  slug: string;
  kind: string;
  title: string;
  excerpt: string | null;
  featuredImageUrl: string | null;
  publishedAt: Date | null;
}

export interface ContentBlock {
  type: "heading" | "paragraph";
  text: string;
}

export interface ContentDetail extends ContentSummary {
  bodyBlocks: ContentBlock[];
}

export async function getPublishedContent(limit?: number): Promise<ContentSummary[]> {
  return prisma.contentItem.findMany({
    where: { status: "PUBLISHED", deletedAt: null, publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { slug: true, kind: true, title: true, excerpt: true, featuredImageUrl: true, publishedAt: true },
  });
}

function parseBlocks(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is ContentBlock =>
      typeof b === "object" && b !== null && (b as { type?: unknown }).type != null && typeof (b as { text?: unknown }).text === "string"
  );
}

export async function getContentBySlug(slug: string): Promise<ContentDetail | null> {
  const item = await prisma.contentItem.findFirst({
    where: { slug, status: "PUBLISHED", deletedAt: null, publishedAt: { lte: new Date() } },
  });
  if (!item) return null;
  return {
    slug: item.slug,
    kind: item.kind,
    title: item.title,
    excerpt: item.excerpt,
    featuredImageUrl: item.featuredImageUrl,
    publishedAt: item.publishedAt,
    bodyBlocks: parseBlocks(item.bodyBlocks),
  };
}

/**
 * Save a content edit as a new immutable revision AND update the working item.
 * Revisions are versioned per content id; the snapshot is the full block
 * document so any version can be restored.
 */
export async function saveContentRevision(
  contentId: string,
  authorUserId: string | null,
  next: { title: string; excerpt: string | null; bodyBlocks: ContentBlock[] }
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.contentRevision.findFirst({
      where: { contentId },
      orderBy: { version: "desc" },
    });
    const version = (last?.version ?? 0) + 1;
    await tx.contentRevision.create({
      data: { contentId, version, authorUserId, snapshot: next as unknown as object },
    });
    await tx.contentItem.update({
      where: { id: contentId },
      data: { title: next.title, excerpt: next.excerpt, bodyBlocks: next.bodyBlocks as unknown as object },
    });
    return version;
  });
}

/**
 * Publish any SCHEDULED items whose scheduledFor time has passed. Idempotent;
 * a nightly/interval scheduler calls this. Returns how many were published.
 */
export async function publishDueScheduled(now: Date = new Date()): Promise<number> {
  const due = await prisma.contentItem.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now }, deletedAt: null },
  });
  for (const item of due) {
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "PUBLISHED", publishedAt: item.scheduledFor ?? now },
    });
  }
  return due.length;
}
