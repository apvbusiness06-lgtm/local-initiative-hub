import { cookies } from "next/headers";
import { getSessionByToken, SESSION_COOKIE_NAME, type SessionUser } from "@/lib/auth/session";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}
