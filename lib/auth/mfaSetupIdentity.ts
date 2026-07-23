// MFA enrolment is reachable two ways: a logged-in user opting in
// voluntarily (full session), or a platform-role user who must enrol
// before their login can complete (the "mfa_setup_required" pending
// cookie issued by loginAction — see BUILD-BRIEF Slice 2). Both the setup
// page and its confirm action need to resolve "who is enrolling" the same
// way, so it lives here once instead of being duplicated.
import { PrismaClient } from "@prisma/client";
import { getSessionByToken } from "@/lib/auth/session";
import { verifySignedPayload } from "@/lib/auth/signedToken";

const prisma = new PrismaClient();

export interface MfaSetupIdentity {
  userId: string;
  email: string;
  forced: boolean;
}

export async function resolveMfaSetupIdentity(
  sessionToken: string | undefined,
  pendingToken: string | undefined
): Promise<MfaSetupIdentity | null> {
  if (sessionToken) {
    const user = await getSessionByToken(sessionToken);
    if (user) return { userId: user.id, email: user.email, forced: false };
  }

  if (pendingToken) {
    const payload = verifySignedPayload<{ userId: string; purpose: string }>(pendingToken);
    if (payload?.purpose === "mfa_setup_required") {
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (user) return { userId: user.id, email: user.email, forced: true };
    }
  }

  return null;
}
