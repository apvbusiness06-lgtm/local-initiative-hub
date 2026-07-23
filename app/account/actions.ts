"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroySessionByToken } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookieOptions";

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) await destroySessionByToken(token);
  jar.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
