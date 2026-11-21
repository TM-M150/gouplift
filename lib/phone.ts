import { normalizeKenyanMobile } from "./kyc";

// The phone number on a GoUplift account. It has to be a Kenyan mobile number,
// and it is kept as +254XXXXXXXXX whichever way it was typed, so the number
// someone signs in with always matches the number stored.
//
// What counts as a Kenyan mobile number is decided in one place,
// normalizeKenyanMobile (lib/kyc.ts), which payouts and identity checks use
// too: 07XX and 01XX numbers, with or without the +254 or 254 in front, and
// with or without spaces, dashes or brackets.

export { normalizeKenyanMobile };

export const KENYAN_MOBILE_MESSAGE =
  "Enter a Kenyan mobile number, like 0712 345 678.";

export const SIGN_IN_IDENTIFIER_MESSAGE =
  "Enter your email address or a Kenyan mobile number, like 0712 345 678.";

/** What someone typed in the "email or phone number" box, worked out. */
export type SignInIdentifier =
  { kind: "email"; email: string } | { kind: "phone"; phoneNumber: string };

/**
 * An email address, or a Kenyan mobile number as +254XXXXXXXXX. Null when it is
 * neither, so a number from another country is turned away before it is sent.
 */
export function parseSignInIdentifier(input: string): SignInIdentifier | null {
  const value = input.trim();
  if (value.includes("@")) return { kind: "email", email: value };
  const phoneNumber = normalizeKenyanMobile(value);
  return phoneNumber ? { kind: "phone", phoneNumber } : null;
}
