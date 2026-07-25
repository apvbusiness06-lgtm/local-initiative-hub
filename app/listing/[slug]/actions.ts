"use server";

import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { submitFirstPartyReview } from "@/lib/reviews";
import { emitEnquiryToGhl } from "@/lib/sync";
import { recordEvent, EVENT } from "@/lib/analytics";

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireField(formData: FormData, key: string, max = 2000): string {
  const v = String(formData.get(key) ?? "").trim();
  return v.slice(0, max);
}

export async function submitEnquiryAction(
  businessId: string,
  tenantId: string,
  slug: string,
  formData: FormData
): Promise<void> {
  const name = requireField(formData, "name", 200);
  const email = requireField(formData, "email", 200).toLowerCase();
  const phone = requireField(formData, "phone", 40) || null;
  const message = requireField(formData, "message", 4000);
  const kind = formData.get("kind") === "QUOTE_REQUEST" ? "QUOTE_REQUEST" : "MESSAGE";

  if (!name || !EMAIL_RE.test(email) || !message) {
    redirect(`/listing/${slug}?enquiry=error`);
  }

  const user = await getCurrentUser();

  const enquiry = await prisma.enquiry.create({
    data: {
      businessId,
      tenantId,
      userId: user?.id,
      kind,
      name,
      email,
      phone,
      message,
    },
  });

  // Sync the lead to the tenant's CRM (GHL) if connected. Idempotent + queued
  // with backoff; a CRM outage never blocks the enquiry itself.
  try {
    await emitEnquiryToGhl({ enquiryId: enquiry.id, tenantId, name, email, phone });
  } catch {
    /* enqueue failure is non-fatal to the user's submission */
  }

  // A submitted enquiry is a real on-site conversion signal (still just a
  // submit — never counted as a won job).
  void recordEvent({ eventKey: EVENT.CTA_ENQUIRY_SUBMIT, tenantId, businessId, userAgent: "server-action" });

  redirect(`/listing/${slug}?enquiry=sent`);
}

const REPORT_REASONS = new Set([
  "incorrect_info",
  "closed_down",
  "inappropriate_content",
  "duplicate_listing",
  "spam",
  "other",
]);

export async function submitReportAction(businessId: string, slug: string, formData: FormData): Promise<void> {
  const reasonRaw = requireField(formData, "reason", 40);
  const reason = REPORT_REASONS.has(reasonRaw) ? reasonRaw : "other";
  const detail = requireField(formData, "detail", 2000) || null;
  const reporterEmail = requireField(formData, "email", 200).toLowerCase() || null;

  if (reporterEmail && !EMAIL_RE.test(reporterEmail)) {
    redirect(`/listing/${slug}?report=error`);
  }

  const user = await getCurrentUser();

  await prisma.moderationReport.create({
    data: {
      subject: "BUSINESS",
      subjectId: businessId,
      reporterUserId: user?.id,
      reporterEmail: user?.id ? null : reporterEmail,
      reason,
      detail,
    },
  });

  redirect(`/listing/${slug}?report=sent`);
}

export async function submitReviewAction(businessId: string, slug: string, formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/listing/${slug}`)}`);

  const rating = Number(formData.get("rating") ?? 0);
  const result = await submitFirstPartyReview({
    businessId,
    userId: user!.id,
    rating,
    title: requireField(formData, "title", 140),
    body: requireField(formData, "body", 4000),
    authorName: requireField(formData, "authorName", 120) || undefined,
  });

  redirect(`/listing/${slug}?review=${result.ok ? "pending" : `error&reviewError=${encodeURIComponent(result.error)}`}#reviews`);
}

export async function submitEditSuggestionAction(businessId: string, slug: string, formData: FormData): Promise<void> {
  const detail = requireField(formData, "detail", 2000);
  const reporterEmail = requireField(formData, "email", 200).toLowerCase() || null;

  if (!detail || (reporterEmail && !EMAIL_RE.test(reporterEmail))) {
    redirect(`/listing/${slug}?edit=error`);
  }

  const user = await getCurrentUser();

  await prisma.moderationReport.create({
    data: {
      subject: "BUSINESS",
      subjectId: businessId,
      reporterUserId: user?.id,
      reporterEmail: user?.id ? null : reporterEmail,
      reason: "suggested_edit",
      detail,
    },
  });

  redirect(`/listing/${slug}?edit=sent`);
}
