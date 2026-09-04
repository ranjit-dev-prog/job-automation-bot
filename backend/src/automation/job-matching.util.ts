import { ApplicantProfile } from './interfaces/job-platform-provider.interface';

function splitList(csv: string | null | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic keyword-overlap relevance score (0-100) — not an LLM judgement, so it's cheap,
 * fast, and auditable (the automation engine can log exactly why a job scored the way it did).
 * A skill/target-role match in the job title counts for more than one buried in the description,
 * since the title is the strongest signal of what the role actually is.
 *
 * Returns 100 (never blocks) when the profile has no skills or target roles set — there's
 * nothing to score against yet, and refusing to apply to everything would be a worse default
 * than letting the user's actual filters (keywords/location) do the gating.
 */
export function computeMatchScore(
  profile: Pick<ApplicantProfile, 'skills' | 'targetRoles'>,
  jobTitle: string,
  jobDescription: string,
): number {
  const skills = splitList(profile.skills);
  const targetRoles = splitList(profile.targetRoles);
  if (skills.length === 0 && targetRoles.length === 0) return 100;

  const titleText = jobTitle.toLowerCase();
  const descText = jobDescription.toLowerCase();

  let matched = 0;
  let total = 0;

  for (const skill of skills) {
    const s = skill.toLowerCase();
    total += 1;
    if (titleText.includes(s)) matched += 1;
    else if (descText.includes(s)) matched += 0.6;
  }

  for (const role of targetRoles) {
    const r = role.toLowerCase();
    total += 2; // a target-role match is a stronger relevance signal than any single skill
    if (titleText.includes(r)) matched += 2;
    else if (descText.includes(r)) matched += 1;
  }

  return Math.round(Math.min(100, (matched / total) * 100));
}
