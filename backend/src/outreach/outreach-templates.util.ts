import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';

function splitList(csv: string | null | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic (non-AI) draft — the reliable default every outreach email/message starts from,
 * regardless of whether an AI provider is configured or reachable (AI, when enabled, only
 * overwrites this if it returns successfully — see OutreachEmailService/ConnectionMessageService).
 * Built entirely from confirmed ApplicantProfile fields (which themselves come from the Profile
 * page, populated from the resume via the upload-suggestions flow) — never invents anything.
 * Kept polite, concise, and professional throughout; the user can still edit the result before
 * sending from the Outreach queue.
 */
export function buildOutreachEmail(
  profile: ApplicantProfile,
  jobTitle: string,
  company: string,
): { subject: string; body: string } {
  const name = profile.fullName ?? 'Applicant';
  const skills = splitList(profile.skills).slice(0, 6).join(', ');
  const experience =
    profile.experienceYears != null
      ? `${profile.experienceYears} year${profile.experienceYears === 1 ? '' : 's'} of experience`
      : null;
  const currentRole =
    profile.currentJobTitle && profile.currentCompany
      ? `${profile.currentJobTitle} at ${profile.currentCompany}`
      : (profile.currentJobTitle ?? profile.currentCompany ?? null);

  const subject = `Application for ${jobTitle} at ${company} — ${name}`;

  const introLine = `I recently submitted my application for the ${jobTitle} position at ${company} and wanted to introduce myself directly in case it's helpful.`;

  const backgroundParts: string[] = [];
  if (currentRole) backgroundParts.push(`I currently work as ${currentRole}`);
  if (experience) backgroundParts.push(currentRole ? `with ${experience} overall` : `I have ${experience}`);
  if (skills) backgroundParts.push(`${backgroundParts.length ? 'and bring' : 'I bring'} hands-on experience with ${skills}`);
  const backgroundLine = backgroundParts.length ? backgroundParts.join(', ') + '.' : null;

  const bodyLines = [
    `Dear Hiring Team,`,
    ``,
    introLine,
    backgroundLine,
    `I've attached my resume for your review, and I'd very much welcome the opportunity to discuss how I could contribute to the team.`,
    ``,
    `Thank you for your time and consideration.`,
    ``,
    `Warm regards,`,
    name,
    profile.phone ?? '',
    profile.linkedinUrl ?? '',
  ].filter((line): line is string => !!line);

  return { subject, body: bodyLines.join('\n') };
}

export function buildConnectionMessage(
  profile: ApplicantProfile,
  jobTitle: string,
  company: string,
  connectionName: string,
): string {
  const name = profile.fullName ?? 'there';
  const firstName = connectionName.split(' ')[0] || connectionName;
  const currentRole = profile.currentJobTitle ? ` — I currently work as ${profile.currentJobTitle}` : '';

  return [
    `Hi ${firstName},`,
    ``,
    `Hope you're doing well! I noticed you're at ${company} and just applied for the ${jobTitle} role there${currentRole}. ` +
      `If you have a moment, I'd really appreciate a referral or a pointer to the right person on the hiring side — ` +
      `happy to share my resume if that's useful.`,
    ``,
    `No worries at all if now isn't a good time — thanks either way!`,
    ``,
    name,
  ].join('\n');
}
