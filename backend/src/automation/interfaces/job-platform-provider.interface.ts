import { Page } from 'playwright';

export interface JobPlatformCredentials {
  username: string;
  password: string;
}

export interface JobSearchFilter {
  keywords: string;
  location?: string;
  remoteOnly?: boolean;
  /** Restrict the search itself to jobs the platform can auto-apply to (e.g. LinkedIn's "Easy Apply"). */
  easyApplyOnly?: boolean;
}

export interface JobListing {
  title: string;
  company?: string;
  url: string;
}

/**
 * Subset of the user's Profile a provider can use to answer application forms — deliberately a
 * plain data shape (not the Prisma model) so providers don't take a dependency on the DB layer.
 * Every field is optional/nullable: absence means "not confirmed by the user", and providers
 * must never guess a value that isn't here.
 */
export interface ApplicantProfile {
  fullName?: string | null;
  phone?: string | null;
  skills?: string | null; // comma-separated
  targetRoles?: string | null; // comma-separated job titles, weighted higher in relevance scoring
  experienceYears?: number | null;
  relevantExperienceYears?: number | null;
  currentCompany?: string | null;
  currentJobTitle?: string | null;
  currentLocation?: string | null;
  preferredLocation?: string | null;
  linkedinUrl?: string | null;
  noticePeriodDays?: number | null;
  currentSalary?: number | null;
  expectedSalary?: number | null;
  workAuthorization?: string | null;
  willingToRelocate?: boolean | null;
  /**
   * Raw text extracted from the uploaded resume. Only ever handed to the AI provider as extra
   * supporting context (e.g. to answer a question phrased differently than the structured
   * fields above) — the deterministic keyword rules in screening-answer.util don't read it.
   */
  resumeText?: string | null;
}

export interface ApplyContext {
  profile: ApplicantProfile;
  /** Minimum job-relevance score (0-100) required before the provider will even attempt to apply. */
  minMatchScore: number;
  /**
   * When true, the provider skips relevance scoring entirely (no keyword/AI call, no
   * minMatchScore check) and goes straight to the Easy Apply/equivalent check — every job found
   * gets attempted regardless of fit. matchScore is left unset on the resulting Application.
   */
  skipRelevanceCheck?: boolean;
}

/**
 * Thrown by a provider's `applyToJob` when a job is deliberately not applied to — no Easy
 * Apply/equivalent, or it scored below the user's minimum relevance threshold — as opposed to a
 * real failure (network error, selector broke, session expired). The automation engine records
 * these as SKIPPED instead of FAILED. `matchScore`, when set, is persisted on the Application row.
 */
export class SkipApplicationError extends Error {
  constructor(
    message: string,
    public readonly matchScore?: number,
  ) {
    super(message);
  }
}

/**
 * Thrown when the provider got partway into an application but hit something it must not
 * handle on its own: a required question it can't answer from ApplicantProfile, or a
 * CAPTCHA/OTP/payment prompt. The automation engine records these as MANUAL_ACTION_REQUIRED
 * and leaves the application unsubmitted — never guess, never bypass, always stop and surface it.
 */
export class ManualActionRequiredError extends Error {}

/**
 * Contract every job-site integration must implement. Auto-login and auto-apply both
 * happen through a single logged-in Playwright `page` the caller owns and reuses across
 * search + apply so the session stays valid.
 */
export interface JobPlatformProvider {
  readonly platform: string;
  login(page: Page, credentials: JobPlatformCredentials): Promise<void>;
  searchJobs(page: Page, filter: JobSearchFilter): Promise<JobListing[]>;
  applyToJob(page: Page, job: JobListing, context: ApplyContext): Promise<void>;
}
