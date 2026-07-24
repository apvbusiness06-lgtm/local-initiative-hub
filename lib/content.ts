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
