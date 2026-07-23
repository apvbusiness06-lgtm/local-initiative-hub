// Shared single-use-token check for email verification and password reset
// tokens — both models carry the same (consumedAt, expiresAt) shape, and
// "used" must be checked before "expired" so a used-and-now-also-expired
// token reports as used, not expired.
export type TokenValidity = "usable" | "already-used" | "expired";

export function checkTokenValidity(record: { consumedAt: Date | null; expiresAt: Date }): TokenValidity {
  if (record.consumedAt) return "already-used";
  if (record.expiresAt.getTime() < Date.now()) return "expired";
  return "usable";
}
