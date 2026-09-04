// Legal-entity suffixes that would otherwise leak into the guessed domain (e.g. "Acme Inc." → "acmeinc.com").
const SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt. ltd.',
  'ltd',
  'llc',
  'llp',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'group',
  'technologies',
  'technology',
  'solutions',
  'systems',
  'labs',
];

// Role-based local-parts to guess for CC — deliberately a short, plausible list, not an attempt
// to guess "everyone in tech/upper management" (most companies don't publish generic aliases for
// every role, and a long CC list of guesses reads as an obvious mass-blast to anyone who actually
// receives it). Each is just as much a guess as guessCompanyEmail's "hr@" — likely to bounce for
// many companies — and is meant to be reviewed/edited before sending, same as the "to" address.
const CC_ROLE_LOCAL_PARTS = ['ceo', 'cto', 'coo', 'techlead', 'hr', 'hrmanager', 'careers', 'talent'];

function domainFromCompanyName(companyName: string): string {
  let slug = companyName.toLowerCase();
  for (const suffix of SUFFIXES) {
    slug = slug.replace(new RegExp(`\\b${suffix}\\b\\.?`, 'g'), '');
  }
  slug = slug.replace(/[^a-z0-9]+/g, '').trim();
  return slug || 'company';
}

/**
 * Best-effort "hr@companyname.com" guess from a company display name — NOT a verified address.
 * Most real companies don't actually use this exact pattern (different domain, different
 * mailbox convention, or no public HR alias at all), so a meaningful share of these will bounce
 * or land somewhere unintended. Every caller must treat the result as a guess, never as a
 * confirmed deliverable address.
 */
export function guessCompanyEmail(companyName: string): string {
  return `hr@${domainFromCompanyName(companyName)}.com`;
}

/**
 * Best-effort role-based CC addresses (CTO, tech lead, HR manager) on the same guessed domain as
 * guessCompanyEmail. Pass the domain directly (e.g. extracted from an already-known/edited email
 * address) when one is available, rather than re-guessing from the company name — keeps the "to"
 * and "cc" guesses consistent with each other.
 */
export function guessRoleEmails(domain: string): string[] {
  return CC_ROLE_LOCAL_PARTS.map((localPart) => `${localPart}@${domain}`);
}

/** Extracts the domain from an email address, or falls back to guessing one from the company name. */
export function domainFromEmailOrCompany(email: string | null | undefined, companyName: string): string {
  const domain = email?.split('@')[1]?.trim();
  return domain || `${domainFromCompanyName(companyName)}.com`;
}
