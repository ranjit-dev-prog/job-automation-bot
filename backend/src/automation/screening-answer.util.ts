import { ApplicantProfile } from './interfaces/job-platform-provider.interface';

export interface ScreeningAnswer {
  kind: 'text' | 'boolean';
  /** For 'boolean' this is always 'Yes' or 'No' — the exact label text Easy Apply radio buttons use. */
  value: string;
}

// Patterns for prompts the bot must never attempt itself — CAPTCHA, one-time codes, and any
// request for payment/financial details. Matching on visible page text rather than a specific
// widget, since these show up in wildly different markup across sites.
const BLOCKER_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /captcha/i, reason: 'a CAPTCHA challenge' },
  { pattern: /one[- ]?time password|verification code|\bOTP\b/i, reason: 'an OTP/verification code prompt' },
  { pattern: /credit card|debit card|card number|payment (details|information)|bank account number/i, reason: 'a payment/financial-details request' },
];

/** Returns a human-readable reason the moment page text matches a known blocker, else null. */
export function detectBlocker(pageText: string): string | null {
  for (const { pattern, reason } of BLOCKER_PATTERNS) {
    if (pattern.test(pageText)) return reason;
  }
  return null;
}

/**
 * Answers one screening-question label using only data explicitly present on ApplicantProfile.
 * Returns null whenever the profile doesn't confirm an answer — callers must treat null as
 * "stop and ask the user", never fall back to a guess or a default.
 */
export function answerScreeningQuestion(profile: ApplicantProfile, question: string): ScreeningAnswer | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  if (/notice period/.test(q)) {
    return profile.noticePeriodDays != null ? { kind: 'text', value: String(profile.noticePeriodDays) } : null;
  }
  if (/expected\s*(ctc|salary|compensation)/.test(q)) {
    return profile.expectedSalary != null ? { kind: 'text', value: String(profile.expectedSalary) } : null;
  }
  if (/current\s*(ctc|salary|compensation)/.test(q)) {
    return profile.currentSalary != null ? { kind: 'text', value: String(profile.currentSalary) } : null;
  }
  if (/work authoriz|sponsorship|visa status|require.*sponsorship/.test(q)) {
    return profile.workAuthorization ? { kind: 'text', value: profile.workAuthorization } : null;
  }
  if (/relocat/.test(q)) {
    return profile.willingToRelocate != null
      ? { kind: 'boolean', value: profile.willingToRelocate ? 'Yes' : 'No' }
      : null;
  }
  if (/relevant experience/.test(q)) {
    return profile.relevantExperienceYears != null
      ? { kind: 'text', value: String(profile.relevantExperienceYears) }
      : null;
  }
  if (/years? of experience|total experience/.test(q)) {
    return profile.experienceYears != null ? { kind: 'text', value: String(profile.experienceYears) } : null;
  }
  if (/phone|mobile number/.test(q)) {
    return profile.phone ? { kind: 'text', value: profile.phone } : null;
  }
  if (/full name|your name/.test(q)) {
    return profile.fullName ? { kind: 'text', value: profile.fullName } : null;
  }
  if (/current (company|employer)/.test(q)) {
    return profile.currentCompany ? { kind: 'text', value: profile.currentCompany } : null;
  }
  if (/current (job )?title|designation/.test(q)) {
    return profile.currentJobTitle ? { kind: 'text', value: profile.currentJobTitle } : null;
  }
  if (/linkedin/.test(q)) {
    return profile.linkedinUrl ? { kind: 'text', value: profile.linkedinUrl } : null;
  }
  if (/current location|based in|city/.test(q)) {
    return profile.currentLocation ? { kind: 'text', value: profile.currentLocation } : null;
  }

  // Generic "Do you have experience with <X>?" yes/no questions, answered only against the
  // user's own declared skill list. An unmatched skill returns null (never "No") — the bot
  // has no way to confirm the negative, only the absence of a positive.
  const skillMatch = /(experience|proficien\w*|familiar|knowledge)\s+(with|in|of)\s+([a-z0-9+#. ]+?)\??$/i.exec(q);
  if (skillMatch) {
    const asked = skillMatch[3].trim();
    const skills = (profile.skills ?? '').toLowerCase();
    if (asked && skills.includes(asked)) return { kind: 'boolean', value: 'Yes' };
    return null;
  }

  return null;
}
