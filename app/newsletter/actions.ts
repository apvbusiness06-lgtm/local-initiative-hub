"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { subscribeToNewsletter, CURRENT_WORDING_TEXT } from "@/lib/newsletter";
import { getMailer } from "@/lib/mailer";

export async function subscribeNewsletterAction(formData: FormData): Promise<void> {
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) redirect("/");

  const consent = formData.get("consent");
  if (consent !== "on") redirect("/?newsletter=consent");

  const email = String(formData.get("email") ?? "");
  const user = await getCurrentUser();

  const result = await subscribeToNewsletter({
    tenantId: tenant!.id,
    email,
    userId: user?.id ?? null,
    ipAddress: hdrs.get("x-forwarded-for"),
    userAgent: hdrs.get("user-agent"),
  });
  if (!result.ok) redirect(`/?newsletter=error`);

  // Send a welcome/confirmation with the one-click unsubscribe link. The link
  // carries the raw token and needs no login to action.
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const unsubUrl = `${proto}://${host}/api/newsletter/unsubscribe?token=${result.unsubscribeToken}`;
  await getMailer().send({
    to: email.trim().toLowerCase(),
    subject: `You're subscribed to ${tenant!.name}`,
    text: `Thanks for subscribing.\n\nYou agreed to: "${CURRENT_WORDING_TEXT}"\n\nUnsubscribe any time: ${unsubUrl}`,
  });

  redirect("/?newsletter=subscribed");
}
