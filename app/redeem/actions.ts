"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { userOwnsBusiness } from "@/lib/claims";
import { redeemClaimByCode } from "@/lib/offers";

export async function redeemAction(businessId: string, formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/redeem?biz=${businessId}`)}`);
  // Only someone who manages this business may redeem its vouchers.
  if (!(await userOwnsBusiness(user!.id, businessId))) redirect(`/redeem?biz=${businessId}&error=forbidden`);

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!code) redirect(`/redeem?biz=${businessId}&error=nocode`);

  const result = await redeemClaimByCode(code, businessId, user!.id);
  if (result.ok) {
    redirect(`/redeem?biz=${businessId}&ok=${encodeURIComponent(result.offerTitle)}`);
  }
  redirect(`/redeem?biz=${businessId}&fail=${result.reason}${result.offerTitle ? `&title=${encodeURIComponent(result.offerTitle)}` : ""}`);
}
