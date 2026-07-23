// RFC 6238 Appendix B gives fixed-time test vectors for SHA1/8-digit TOTP
// using the ASCII secret "12345678901234567890". Truncation is digit-count
// agnostic — (x mod 10^8) mod 10^6 == x mod 10^6 — so the last 6 digits of
// each published 8-digit vector is the correct expected 6-digit code.
import { describe, expect, it } from "vitest";
import { base32Encode, base32Decode } from "@/lib/base32";
import { totpAt, generateSecret, generateTotp, verifyTotp } from "@/lib/auth/totp";

const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const original = Buffer.from([0, 1, 2, 253, 254, 255, 17, 42]);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });
});

describe("TOTP — RFC 6238 Appendix B vectors (SHA1)", () => {
  const vectors: [number, string][] = [
    [59, "287082"], // T = 0000000000000001
    [1111111109, "081804"], // T = 00000000023523EC
    [1111111111, "050471"], // T = 00000000023523ED
    [1234567890, "005924"], // T = 000000000273EF07
    [2000000000, "279037"], // T = 0000000027BC86AA
  ];

  for (const [unixSeconds, expected] of vectors) {
    it(`matches at T=${unixSeconds}`, () => {
      expect(totpAt(RFC_SECRET_B32, unixSeconds * 1000)).toBe(expected);
    });
  }
});

describe("verifyTotp", () => {
  it("accepts the current code for a freshly generated secret", () => {
    const secret = generateSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const secret = generateSecret();
    const code = generateTotp(secret);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, "not-a-code")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
  });

  it("accepts a code from one step in the past (clock drift tolerance)", () => {
    const secret = generateSecret();
    const previousStepCode = totpAt(secret, Date.now() - 30_000);
    expect(verifyTotp(secret, previousStepCode, 1)).toBe(true);
  });

  it("rejects a code two steps away when window is 1", () => {
    const secret = generateSecret();
    const farCode = totpAt(secret, Date.now() - 90_000);
    expect(verifyTotp(secret, farCode, 1)).toBe(false);
  });
});
