import { resolveMx } from 'node:dns/promises';

// Length-bounded (not unbounded `+`) so a crafted/pathological page can't trigger catastrophic
// backtracking — this runs against arbitrary external HTML, not trusted input.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}/g;

// Pages likely to publish a real contact/HR address. Fetched in parallel (not one at a time) so
// one slow/unresponsive path can't multiply the wall time for a company — see scrapeCompanyEmail.
const PATHS_TO_TRY = ['', '/contact', '/careers', '/about'];

// If a page has multiple email addresses, prefer one that reads like an HR/recruiting contact
// over a generic sales/support/info alias.
const PREFERRED_LOCAL_PART_KEYWORDS = ['hr', 'career', 'job', 'talent', 'recruit', 'people', 'hiring'];

const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; JobAutomationBot/1.0; +outreach email lookup)';

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractDomainEmails(html: string, domain: string): string[] {
  const matches = html.match(EMAIL_REGEX) ?? [];
  const unique = [...new Set(matches.map((m) => m.toLowerCase()))];
  // Only trust addresses actually on the company's own domain — a page's footer/analytics/ad
  // scripts routinely leak third-party addresses that have nothing to do with this company.
  return unique.filter((e) => e.endsWith(`@${domain}`));
}

/**
 * Only accept an address whose local part actually reads like an HR/recruiting contact (hr@,
 * careers@, jobs@, talent@, etc.) — NOT just any address found on the domain. A page can easily
 * contain an engineer's personal address (a blog byline, a docs code sample, a support ticket
 * quoted in a case study) that has nothing to do with hiring; guessing hr@domain and being wrong
 * is an obvious, expected guess, but silently mailing a stranger's personal inbox because it
 * happened to appear in a scraped page is a different, worse kind of wrong. Returns null — keep
 * the guessed fallback — rather than pick an unverified address just because one was found.
 */
function pickBest(emails: string[]): string | null {
  return emails.find((e) => PREFERRED_LOCAL_PART_KEYWORDS.some((k) => e.split('@')[0].includes(k))) ?? null;
}

/**
 * Best-effort real-email lookup for a company: fetches its likely homepage/contact/careers pages
 * over plain HTTPS and scans the raw HTML for an HR-looking address on that domain. Not a
 * guarantee — many sites publish no email at all, gate it behind a JS-rendered contact form,
 * block scraping, or only expose non-HR addresses — callers must keep the guessed hr@domain
 * fallback for when this returns null.
 *
 * All candidate paths are fetched in parallel (not one at a time): a single slow or unresponsive
 * page — a dead domain, a site behind bot-protection that stalls the connection — would otherwise
 * multiply the wall time by every path tried. Fetching in parallel bounds one company's lookup to
 * roughly one FETCH_TIMEOUT_MS window no matter how many paths are checked.
 */
export async function scrapeCompanyEmail(domain: string): Promise<string | null> {
  const pages = await Promise.allSettled(PATHS_TO_TRY.map((path) => fetchPage(`https://${domain}${path}`)));
  for (const page of pages) {
    if (page.status !== 'fulfilled' || !page.value) continue;
    const best = pickBest(extractDomainEmails(page.value, domain));
    if (best) return best;
  }
  return null;
}

const MX_TIMEOUT_MS = 5_000;
const MX_TIMED_OUT = Symbol('mx-lookup-timed-out');

/**
 * Checks whether a domain has any mail exchanger configured at all — a cheap, decisive check
 * that catches the worst class of guessed address: a guessed domain (typo'd company-name slug, or
 * a company that doesn't actually own <name>.com) that can't receive mail no matter what local
 * part is used. `false` here means sending WILL hard-bounce; it does not mean a specific mailbox
 * exists (that still can't be verified without actually sending).
 *
 * `dns.resolveMx` is a c-ares/UDP-based lookup — the same family of DNS call that was found to
 * hang for up to ~2 minutes per domain on this network before falling back to anything else (see
 * smtp-host-resolver.util.ts). There's no dns.lookup()-equivalent fallback for MX records, so
 * instead this races the lookup against a short timeout and, on timeout, returns `true` (assume
 * mail CAN be received) rather than `false` — a real company's mail server timing out on this
 * network is far more likely than the company genuinely having no mail server at all, and this
 * function's whole purpose is to flag domains we're confident about, not to guess on ambiguity.
 * Only a lookup that actually completes and comes back empty/erroring counts as "no mail server".
 */
export async function hasMxRecords(domain: string): Promise<boolean> {
  const timeout = new Promise<typeof MX_TIMED_OUT>((resolve) => setTimeout(() => resolve(MX_TIMED_OUT), MX_TIMEOUT_MS));
  try {
    const result = await Promise.race([resolveMx(domain), timeout]);
    if (result === MX_TIMED_OUT) return true;
    return result.length > 0;
  } catch {
    return false;
  }
}
