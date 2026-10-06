// Institution accounts: rules shared by the web app and the
// `institution-accounts` edge function. Deno-safe: no imports.
//
// People sign in with a username and password. Supabase Auth needs an email,
// so a username maps to an internal address that is never emailed.

export const ACCOUNT_EMAIL_DOMAIN = 'accounts.yetnew.app';
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const MIN_PASSWORD = 8;

export const normalizeUsername = (s: string) => s.trim().toLowerCase().replace(/^@/, '');
export const usernameToEmail = (username: string) => `${normalizeUsername(username)}@${ACCOUNT_EMAIL_DOMAIN}`;
/** What the sign-in box gets: a username, or (older accounts) an email address. */
export const signInEmail = (identifier: string) => (identifier.includes('@') && !identifier.trim().startsWith('@') ? identifier.trim() : usernameToEmail(identifier));
export const usernameFromEmail = (email: string | null | undefined) =>
  email?.endsWith(`@${ACCOUNT_EMAIL_DOMAIN}`) ? email.slice(0, -ACCOUNT_EMAIL_DOMAIN.length - 1) : null;

export function usernameProblem(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 30) return 'At most 30 characters.';
  if (!USERNAME_RE.test(u)) return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  return null;
}

export function passwordProblem(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters.`;
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Mix letters and numbers.';
  return null;
}

export type InstitutionKind = 'park' | 'museum' | 'heritage' | 'campus' | 'hospital' | 'mall' | 'other';

/** What kind of place an institution runs decides its venue's starting layout and look. */
export const INSTITUTION_KINDS: Record<InstitutionKind, { label: string; layout: 'building' | 'site'; theme: 'park' | 'heritage' | 'modern'; firstArea: string }> = {
  park:     { label: 'Park or garden',      layout: 'site',     theme: 'park',     firstArea: 'Entire park' },
  museum:   { label: 'Museum or gallery',   layout: 'building', theme: 'heritage', firstArea: 'Ground floor' },
  heritage: { label: 'Heritage site',       layout: 'site',     theme: 'heritage', firstArea: 'Entire site' },
  campus:   { label: 'University or campus', layout: 'site',    theme: 'modern',   firstArea: 'Entire campus' },
  hospital: { label: 'Hospital',            layout: 'building', theme: 'modern',   firstArea: 'Ground floor' },
  mall:     { label: 'Mall or market',      layout: 'building', theme: 'modern',   firstArea: 'Ground floor' },
  other:    { label: 'Something else',      layout: 'building', theme: 'modern',   firstArea: 'Ground floor' },
};
export const isInstitutionKind = (k: unknown): k is InstitutionKind => typeof k === 'string' && k in INSTITUTION_KINDS;

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'venue';
