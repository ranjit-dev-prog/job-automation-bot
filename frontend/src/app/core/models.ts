export interface ResumeSuggestions {
  fullName?: string;
  email?: string;
  phone?: string;
  skills?: string;
  education?: string;
  experienceYears?: number;
}

export interface Profile {
  id: string;
  userId: string;
  fullName: string | null;
  phone: string | null;
  address: string | null;
  skills: string | null;
  targetRoles: string | null;
  experienceYears: number | null;
  relevantExperienceYears: number | null;
  education: string | null;
  currentCompany: string | null;
  currentJobTitle: string | null;
  currentLocation: string | null;
  preferredLocation: string | null;
  linkedinUrl: string | null;
  noticePeriodDays: number | null;
  currentSalary: number | null;
  expectedSalary: number | null;
  workAuthorization: string | null;
  willingToRelocate: boolean | null;
  resumeFilename: string | null;
  resumePath: string | null;
  updatedAt: string;
}

export type Platform = 'LINKEDIN' | 'NAUKRI' | 'INDEED' | 'HIRIST' | 'CUSTOM';

export const PLATFORMS: Platform[] = ['LINKEDIN', 'NAUKRI', 'INDEED', 'HIRIST', 'CUSTOM'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  LINKEDIN: 'LinkedIn',
  NAUKRI: 'Naukri',
  INDEED: 'Indeed',
  HIRIST: 'Hirist',
  CUSTOM: 'Custom platform',
};

export interface CredentialSummary {
  id: string;
  platform: Platform;
  createdAt: string;
  updatedAt: string;
}

export interface JobFilter {
  id: string;
  name: string;
  keywords: string;
  location: string | null;
  remoteOnly: boolean;
  easyApplyOnly: boolean;
  minMatchScore: number;
  directApply: boolean;
  minSalary: number | null;
  emailOutreachEnabled: boolean;
  connectionOutreachEnabled: boolean;
  platforms: string; // comma-separated
  delaySeconds: number;
  searchIntervalMinutes: number;
  maxApplicationsPerDay: number;
  customRulesJson: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus = 'PENDING' | 'APPLIED' | 'FAILED' | 'SKIPPED' | 'MANUAL_ACTION_REQUIRED';

export interface JobApplication {
  id: string;
  platform: string;
  jobTitle: string;
  company: string | null;
  jobUrl: string;
  status: ApplicationStatus;
  matchScore: number | null;
  appliedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export type AgentState =
  | 'SEARCHING'
  | 'WAITING_FOR_NEW_JOBS'
  | 'OPENING_JOB'
  | 'APPLYING'
  | 'APPLICATION_COMPLETED'
  | 'MANUAL_ACTION_REQUIRED'
  | 'RATE_LIMITED'
  | 'ERROR'
  | 'PAUSED'
  | 'STOPPED';

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  SEARCHING: 'Searching for new jobs',
  WAITING_FOR_NEW_JOBS: 'Waiting for new jobs',
  OPENING_JOB: 'Opening job',
  APPLYING: 'Applying',
  APPLICATION_COMPLETED: 'Application completed',
  MANUAL_ACTION_REQUIRED: 'Manual action required',
  RATE_LIMITED: 'Rate limited',
  ERROR: 'Error',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
};

export type OutreachStatus = 'DRAFT' | 'SENT' | 'FAILED';

export interface OutreachEmail {
  id: string;
  company: string;
  toEmail: string;
  emailSource: EmailSource;
  ccEmails: string | null;
  subject: string;
  body: string;
  attachResume: boolean;
  status: OutreachStatus;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface ConnectionMessage {
  id: string;
  company: string;
  connectionName: string;
  connectionProfileUrl: string;
  message: string;
  status: OutreachStatus;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface MailCredentialStatus {
  connected: boolean;
  gmailUser: string | null;
}

export type EmailSource = 'guessed' | 'scraped' | 'manual' | 'not_found' | 'invalid_domain';

export interface TargetCompany {
  id: string;
  companyName: string;
  email: string;
  emailSource: EmailSource;
  contactName: string | null;
  roleOfInterest: string | null;
  notes: string | null;
  createdAt: string;
  draftedAt: string | null;
}

export type OutreachChannel = 'EMAIL' | 'LINKEDIN_MESSAGE';
export type OutreachLogResult = 'SUCCESS' | 'FAILED';

export interface OutreachLog {
  id: string;
  channel: OutreachChannel;
  outreachEmailId: string | null;
  connectionMessageId: string | null;
  recipient: string;
  subject: string | null;
  result: OutreachLogResult;
  errorMessage: string | null;
  createdAt: string;
}

export interface AutomationStatus {
  running: boolean;
  paused: boolean;
  state: AgentState;
  platformsLoggedIn: string[];
  rateLimitedPlatforms: string[];
  platformErrors: Record<string, string>;
  pendingCount: number;
  appliedToday: number;
  lastError?: string;
  uptimeMs: number;
  jobsScanned: number;
  newJobsFound: number;
  applicationsCount: number;
  nextSearchAt: number | null;
}
