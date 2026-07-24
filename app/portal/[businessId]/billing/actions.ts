"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { userOwnsBusiness } from "@/lib/claims";
import { createCheckoutSession, createBillingPortalSession, type BillingInterval } from "@/lib/billing";
import { isBillingConfigured } from "@/lib/stripe";

async function requireOwnerAndOrigin(businessId: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/portal/${businessId}/billing`)}`);
  if (!(await userOwnsBusiness(user!.id, businessId))) redirect("/portal?error=forbidden");
  const host = (await headers()).get("host") ?? "";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${proto}://${host}`;
}

export async function startCheckoutAction(businessId: string, planKey: string, formData: FormData): Promise<void> {
  const origin = await requireOwnerAndOrigin(businessId);
  if (!isBillingConfigured()) redirect(`/portal/${businessId}/billing?error=notconfigured`);

  const interval: BillingInterval = formData.get("interval") === "yearly" ? "yearly" : "monthly";
  const result = await createCheckoutSession({ businessId, planKey, interval, origin });
  if ("error" in result) redirect(`/portal/${businessId}/billing?error=${encodeURIComponent(result.error)}`);
  redirect(result.url);
}

export async function manageBillingAction(businessId: string): Promise<void> {
  const origin = await requireOwnerAndOrigin(businessId);
  const result = await createBillingPortalSession(businessId, origin);
  if ("error" in result) redirect(`/portal/${businessId}/billing?error=${encodeURIComponent(result.error)}`);
  redirect(result.url);
}
