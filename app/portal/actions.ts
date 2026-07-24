"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  saveProfile,
  saveCategories,
  saveOpeningHours,
  addService,
  deleteService,
  type ProfileEdit,
} from "@/lib/portal";
import { uploadGalleryImage, deleteGalleryImage } from "@/lib/media";
import { userOwnsBusiness } from "@/lib/claims";

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

async function requireOwner(businessId: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/portal/${businessId}`)}`);
  if (!(await userOwnsBusiness(user!.id, businessId))) redirect("/portal?error=forbidden");
  return user!.id;
}

export async function saveProfileAction(businessId: string, formData: FormData): Promise<void> {
  const userId = await requireOwner(businessId);
  const edit: ProfileEdit = {
    tradingName: s(formData, "tradingName"),
    summary: s(formData, "summary"),
    description: s(formData, "description"),
    websiteUrl: s(formData, "websiteUrl"),
    phone: s(formData, "phone"),
    email: s(formData, "email"),
    addressLine1: s(formData, "addressLine1"),
    addressLine2: s(formData, "addressLine2"),
    locality: s(formData, "locality"),
    postcode: s(formData, "postcode"),
  };
  const result = await saveProfile(userId, businessId, edit);
  const flag = !result.ok ? `error=${encodeURIComponent(result.error ?? "failed")}` : result.moderationHeld ? "saved=review" : "saved=1";
  redirect(`/portal/${businessId}?${flag}#profile`);
}

export async function saveCategoriesAction(businessId: string, formData: FormData): Promise<void> {
  const userId = await requireOwner(businessId);
  const slugs = formData.getAll("cat").map(String).filter(Boolean);
  const result = await saveCategories(userId, businessId, slugs);
  redirect(`/portal/${businessId}?${result.ok ? "saved=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}#categories`);
}

export async function saveHoursAction(businessId: string, formData: FormData): Promise<void> {
  const userId = await requireOwner(businessId);
  const hours = Array.from({ length: 7 }, (_, day) => ({
    dayOfWeek: day,
    isClosed: formData.get(`closed_${day}`) === "on",
    opensAt: s(formData, `opens_${day}`) || "09:00",
    closesAt: s(formData, `closes_${day}`) || "17:00",
  }));
  const result = await saveOpeningHours(userId, businessId, hours);
  redirect(`/portal/${businessId}?${result.ok ? "saved=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}#hours`);
}

export async function addServiceAction(businessId: string, formData: FormData): Promise<void> {
  const userId = await requireOwner(businessId);
  const priceRaw = s(formData, "price").trim();
  const priceMinor = priceRaw ? Math.round(Number(priceRaw) * 100) : null;
  const result = await addService(userId, businessId, {
    name: s(formData, "name"),
    description: s(formData, "description"),
    priceMinor: priceMinor != null && Number.isFinite(priceMinor) ? priceMinor : null,
    isFromPrice: formData.get("isFromPrice") === "on",
  });
  redirect(`/portal/${businessId}?${result.ok ? "saved=1" : `error=${encodeURIComponent(result.error ?? "failed")}`}#services`);
}

export async function deleteServiceAction(businessId: string, serviceId: string): Promise<void> {
  const userId = await requireOwner(businessId);
  await deleteService(userId, businessId, serviceId);
  redirect(`/portal/${businessId}?saved=1#services`);
}

export async function uploadImageAction(businessId: string, formData: FormData): Promise<void> {
  await requireOwner(businessId);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/portal/${businessId}?error=${encodeURIComponent("Choose an image to upload.")}#gallery`);
  }
  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const result = await uploadGalleryImage(businessId, { buffer, declaredType: (file as File).type }, s(formData, "altText"));
  redirect(`/portal/${businessId}?${result.ok ? "saved=1" : `error=${encodeURIComponent(result.error)}`}#gallery`);
}

export async function deleteImageAction(businessId: string, assetId: string): Promise<void> {
  await requireOwner(businessId);
  await deleteGalleryImage(businessId, assetId);
  redirect(`/portal/${businessId}?saved=1#gallery`);
}
