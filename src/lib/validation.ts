/**
 * Shared input validation helpers.
 *
 * isValidEmail is intentionally a *format* check only — this app has no
 * email verification step for the guest email-gate flow (EmailGateDialog),
 * so this is the only thing standing between "identification" and garbage
 * data landing in the profiles table. It's also reused by the magic-link
 * sign-in flow (CreateProfilePrompt) for consistency, even though Supabase
 * will separately reject a genuinely undeliverable address there.
 */

// Deliberately a bit stricter than the bare minimum: requires a dot in the
// domain part with a real TLD, rejects leading/trailing/consecutive dots in
// the local + domain parts, and disallows whitespace.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('..')) return false;
  return EMAIL_RE.test(trimmed);
}

/** Trims + lowercases an email for storage/comparison. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
