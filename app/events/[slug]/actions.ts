"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { rsvpToOccurrence } from "@/lib/events";

export async function rsvpAction(slug: string, occurrenceId: string, formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/events/${slug}`)}`);
  const guests = Number(formData.get("guests") ?? 1);
  const result = await rsvpToOccurrence(occurrenceId, user!.id, Number.isFinite(guests) ? guests : 1);
  redirect(`/events/${slug}?${result.ok ? "rsvp=1" : `error=${encodeURIComponent(result.error)}`}`);
}
