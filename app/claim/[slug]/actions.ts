"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { getListingForTenant } from "@/lib/listing";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { startClaim } from "@/lib/claims";
import { getMailer } from "@/lib/mailer";

export async function startClaimAction(slug: string): Promise<void> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/claim/${slug}`)}`);

  // Visibility + existence check goes through the same tenant-scoped path the
  // public page uses — you can't claim a listing you can't see on this tenant.
  const listing = await getListingForTenant(tenant!.id, slug);
  if (!listing) redirect("/");
  if (listing!.claimState === "CLAIMED") redirect(`/claim/${slug}?state=already`);

  const started = await startClaim(listing!.id, user!.id);

  if (started.method === "ADMIN_REVIEW") {
    redirect(`/claim/${slug}?state=review`);
  }

  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const verifyUrl = `${proto}://${host}/claim/verify?token=${started.rawToken}`;

  const result = await getMailer().send({
    to: started.emailTo!,
    subject: `Confirm your claim of ${listing!.tradingName}`,
    text:
      `Someone (hopefully you) asked to claim the ${listing!.tradingName} listing on ${tenant!.name}.\n\n` +
      `If this was you, confirm by opening this link within 48 hours:\n\n${verifyUrl}\n\n` +
      `This proves you control this email address. A directory admin then completes the review.\n` +
      `If this wasn't you, ignore this email — no changes are made.`,
  });

  // Sandbox mode (no real SMTP configured) can't deliver, so surface the
  // link inline for local testing — never in production, where result.sandbox
  // is false and the link only reaches the real inbox.
  const params = new URLSearchParams({ state: "emailed", to: started.maskedEmail! });
  if (result.sandbox) params.set("devLink", verifyUrl);
  redirect(`/claim/${slug}?${params.toString()}`);
}
