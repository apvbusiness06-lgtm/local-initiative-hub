"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getOfferForTenant, claimOffer } from "@/lib/offers";

export async function claimOfferAction(slug: string): Promise<void> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/offers/${slug}`)}`);

  const offer = await getOfferForTenant(tenant!.id, slug);
  if (!offer) redirect("/offers");

  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const result = await claimOffer(offer!.id, user!.id, `${proto}://${host}`);
  if ("error" in result) redirect(`/offers/${slug}?error=${encodeURIComponent(result.error)}`);
  redirect(`/offers/${slug}?claimed=1`);
}
