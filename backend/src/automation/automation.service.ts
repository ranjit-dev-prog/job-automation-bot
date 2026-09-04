import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import { ResumeParserService } from '../profile/resume-parser.service';
import { OutreachEmailService } from '../outreach/outreach-email.service';
import { ConnectionMessageService } from '../outreach/connection-message.service';
import { ProviderRegistryService } from './provider-registry.service';
import { LinkedInProvider } from './providers/linkedin.provider';
import {
  ApplicantProfile,
  ManualActionRequiredError,
  SkipApplicationError,
} from './interfaces/job-platform-provider.interface';

interface CustomRules {
  excludeCompanies?: string[];
}

function parseCustomRules(json: string | null): CustomRules {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function isExcluded(company: string | undefined, rules: CustomRules): boolean {
  if (!company || !rules.excludeCompanies?.length) return false;
  const lowerCompany = company.toLowerCase();
  return rules.excludeCompanies.some((excluded) => lowerCompany.includes(excluded.toLowerCase()));
}

/** Maps the Prisma Profile row onto the plain shape providers use to score/fill applications. */
function toApplicantProfile(profile: {
  fullName: string | null;
  phone: string | null;
  skills: string | null;
  targetRoles: string | null;
  experienceYears: number | null;
  relevantExperienceYears: number | null;
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
} | null, resumeText: string | null): ApplicantProfile {
  if (!profile) return { resumeText };
  const {
    fullName,
    phone,
    skills,
    targetRoles,
    experienceYears,
    relevantExperienceYears,
    currentCompany,
    currentJobTitle,
    currentLocation,
    preferredLocation,
    linkedinUrl,
    noticePeriodDays,
    currentSalary,
    expectedSalary,
    workAuthorization,
    willingToRelocate,
  } = profile;
  return {
    fullName,
    phone,
    skills,
    targetRoles,
    experienceYears,
    relevantExperienceYears,
    currentCompany,
    currentJobTitle,
    currentLocation,
    preferredLocation,
    linkedinUrl,
    noticePeriodDays,
    currentSalary,
    expectedSalary,
    workAuthorization,
    willingToRelocate,
    resumeText,
  };
}

/** Maps an applyToJob failure to the Application status/matchScore it should be recorded with. */
function classifyApplyError(err: unknown): { status: string; matchScore?: number } {
  if (err instanceof SkipApplicationError) return { status: 'SKIPPED', matchScore: err.matchScore };
  if (err instanceof ManualActionRequiredError) return { status: 'MANUAL_ACTION_REQUIRED' };
  return { status: 'FAILED' };
}

// Heuristic only — platforms don't expose a structured "you're rate limited" signal, so this
// matches common wording in login/search failures that indicates the platform itself pushed
// back, as opposed to a selector breaking or a real network error.
const RATE_LIMIT_PATTERN = /rate limit|too many requests|unusual activity|try again later|temporarily restricted/i;

// How often the engine checks whether it's clear to apply to the next queued job. Lower means
// it moves to the next job faster once the per-filter delay window has elapsed, at the cost of
// polling the session more often. 1s (paired with a 1s minimum delaySeconds) is user-requested
// maximum speed — sub-5s pacing reads as clearly non-human to LinkedIn's bot detection and
// raises real risk of a CAPTCHA checkpoint or account flag; this is not a "safe" default.
const TICK_INTERVAL_MS = 1_000;

/**
 * Coarse-grained states surfaced to the UI so a long-running session reads as an active agent,
 * not a black box. Set at the point in tick()/searchAndQueue() where the engine is actually
 * doing that thing — not a claim about fine-grained browser-level progress the engine doesn't
 * actually track (e.g. there's no separate FILLING_FORM vs REVIEWING signal from the provider).
 */
export type AutomationState =
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

interface UserAutomationSession {
  filterId: string;
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, Page>;
  interval: ReturnType<typeof setInterval>;
  lastAppliedAt: number;
  lastSearchAt: number;
  isTicking: boolean;
  lastError?: string;
  platformErrors: Record<string, string>;
  /** Extracted once at session start (parsing a resume file on every tick would be wasteful). */
  resumeText: string | null;
  /**
   * Dedicated tab for connection lookups/messages — deliberately never the same Page as the
   * job-search/apply loop uses. Sharing a page meant every connection lookup navigated the
   * active job-search tab away mid-flow; this opens as a second, separate window/tab in the
   * same logged-in browser context instead. Created lazily on first outreach use.
   */
  outreachPage: Page | null;

  state: AutomationState;
  startedAt: number;
  paused: boolean;
  /** Platforms that recently looked rate-limited — skipped for new job selection until resumed. */
  rateLimitedPlatforms: Set<string>;
  jobsScanned: number;
  newJobsFound: number;
  applicationsCount: number;
  nextSearchAt: number;
}

interface FilterForSearch {
  id: string;
  keywords: string;
  location: string | null;
  remoteOnly: boolean;
  easyApplyOnly: boolean;
  customRulesJson: string | null;
  emailOutreachEnabled: boolean;
  connectionOutreachEnabled: boolean;
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  private readonly sessions = new Map<string, UserAutomationSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: CredentialsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly config: ConfigService,
    private readonly resumeParser: ResumeParserService,
    private readonly linkedIn: LinkedInProvider,
    private readonly outreachEmailService: OutreachEmailService,
    private readonly connectionMessageService: ConnectionMessageService,
  ) {}

  async start(userId: string, filterId: string) {
    if (this.sessions.has(userId)) {
      throw new ConflictException('Automation is already running for this account');
    }

    const filter = await this.prisma.jobFilter.findUnique({ where: { id: filterId } });
    if (!filter) throw new NotFoundException('Filter not found');
    if (filter.userId !== userId) throw new ForbiddenException();

    const platforms = filter.platforms
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const headless = this.config.get<string>('PLAYWRIGHT_HEADLESS', 'true') !== 'false';
    const browser = await chromium.launch({
      headless,
      // Slowed down + a normal window size when running headed, so a human watching the
      // window can actually follow what the bot is doing instead of it flashing by.
      slowMo: headless ? undefined : 250,
      args: headless ? undefined : ['--window-size=1280,900'],
    });
    const context = await browser.newContext({ viewport: headless ? undefined : null });
    const pages = new Map<string, Page>();
    const platformErrors: Record<string, string> = {};

    for (const platform of platforms) {
      try {
        const creds = await this.credentialsService.getDecryptedForAutomation(userId, platform);
        const provider = this.providerRegistry.get(platform);
        const page = await context.newPage();
        await provider.login(page, creds);
        pages.set(platform, page);
      } catch (err) {
        const message = (err as Error).message;
        platformErrors[platform] = message;
        this.logger.warn(`Platform "${platform}" unavailable for user ${userId}: ${message}`);
      }
    }

    if (pages.size === 0) {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      return { started: false, platformsLoggedIn: [], platformErrors };
    }

    const profileRow = await this.prisma.profile.findUnique({ where: { userId } });
    const resumeText = profileRow?.resumePath
      ? await this.resumeParser.extractText(profileRow.resumePath)
      : null;

    const session: UserAutomationSession = {
      filterId,
      browser,
      context,
      pages,
      interval: setInterval(() => this.tick(userId), TICK_INTERVAL_MS),
      lastAppliedAt: 0,
      lastSearchAt: 0,
      isTicking: false,
      platformErrors,
      resumeText,
      outreachPage: null,
      state: 'SEARCHING',
      startedAt: Date.now(),
      paused: false,
      rateLimitedPlatforms: new Set(),
      jobsScanned: 0,
      newJobsFound: 0,
      applicationsCount: 0,
      nextSearchAt: 0,
    };
    this.sessions.set(userId, session);

    await this.searchAndQueue(userId, filter, session);
    session.lastSearchAt = Date.now();
    session.nextSearchAt = Date.now() + filter.searchIntervalMinutes * 60_000;

    return { started: true, platformsLoggedIn: [...pages.keys()], platformErrors };
  }

  /**
   * Searches every logged-in, non-rate-limited platform for this filter and queues any new
   * matches as PENDING (or SKIPPED if excluded by customRulesJson). Used both on start and,
   * from tick(), whenever the queue runs dry — so a long-running session keeps finding new
   * postings instead of going idle forever once its first batch is exhausted.
   */
  private async searchAndQueue(
    userId: string,
    filter: FilterForSearch,
    session: UserAutomationSession,
  ): Promise<number> {
    session.state = 'SEARCHING';
    const customRules = parseCustomRules(filter.customRulesJson);
    let queuedCount = 0;

    const outreachEnabled = filter.emailOutreachEnabled || filter.connectionOutreachEnabled;
    const applicantProfile = outreachEnabled
      ? toApplicantProfile(await this.prisma.profile.findUnique({ where: { userId } }), session.resumeText)
      : null;

    for (const [platform, page] of session.pages) {
      if (session.rateLimitedPlatforms.has(platform)) continue; // give it a rest, keep others going
      try {
        const provider = this.providerRegistry.get(platform);
        const listings = await provider.searchJobs(page, {
          keywords: filter.keywords,
          location: filter.location ?? undefined,
          remoteOnly: filter.remoteOnly,
          easyApplyOnly: filter.easyApplyOnly,
        });
        session.jobsScanned += listings.length;

        for (const job of listings) {
          const existing = await this.prisma.application.findFirst({
            where: { userId, jobUrl: job.url },
          });
          if (existing) continue;

          const excluded = isExcluded(job.company, customRules);
          const application = await this.prisma.application.create({
            data: {
              userId,
              filterId: filter.id,
              platform,
              jobTitle: job.title,
              company: job.company,
              jobUrl: job.url,
              status: excluded ? 'SKIPPED' : 'PENDING',
              errorMessage: excluded ? `Matched customRulesJson.excludeCompanies` : undefined,
            },
          });
          session.newJobsFound++;
          if (!excluded) queuedCount++;

          if (!excluded && applicantProfile) {
            await this.draftOutreach(userId, filter, platform, session, application, applicantProfile);
          }
        }
      } catch (err) {
        const message = (err as Error).message;
        session.platformErrors[platform] = message;
        this.logger.warn(`Search on "${platform}" failed for user ${userId}: ${message}`);
        if (RATE_LIMIT_PATTERN.test(message)) {
          session.rateLimitedPlatforms.add(platform);
          session.state = 'RATE_LIMITED';
        }
      }
    }

    return queuedCount;
  }

  /**
   * Drafts outreach for one newly-queued job, per the filter's opt-in flags. Both kinds of draft
   * sit as DRAFT in the Outreach queue until the user explicitly approves + sends them — nothing
   * here reaches a real inbox or a real person unattended.
   */
  private async draftOutreach(
    userId: string,
    filter: FilterForSearch,
    platform: string,
    session: UserAutomationSession,
    application: { id: string; jobTitle: string; company: string | null },
    profile: ApplicantProfile,
  ): Promise<void> {
    if (filter.emailOutreachEnabled) {
      await this.outreachEmailService.draftForApplication(userId, application, profile).catch((err) => {
        this.logger.warn(`Email outreach draft failed for application ${application.id}: ${(err as Error).message}`);
      });
    }

    if (filter.connectionOutreachEnabled && platform === 'LINKEDIN' && application.company) {
      try {
        const outreachPage = await this.getOutreachPage(session);
        const connections = await this.linkedIn.findConnectionsAtCompany(outreachPage, application.company);
        if (connections.length) {
          await this.connectionMessageService.draftForApplication(userId, application, profile, connections);
        }
      } catch (err) {
        this.logger.warn(
          `Connection outreach draft failed for application ${application.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Lazily opens (once per session) a browser tab dedicated to outreach — connection lookups and
   * message sends never touch the job-search/apply tab. Same logged-in context, so no separate
   * login is needed; it just shows up as a second visible window when running headed.
   */
  private async getOutreachPage(session: UserAutomationSession): Promise<Page> {
    if (session.outreachPage && !session.outreachPage.isClosed()) return session.outreachPage;
    session.outreachPage = await session.context.newPage();
    return session.outreachPage;
  }

  private async tick(userId: string) {
    const session = this.sessions.get(userId);
    if (!session || session.isTicking || session.paused) return;
    session.isTicking = true;

    try {
      const filter = await this.prisma.jobFilter.findUnique({ where: { id: session.filterId } });
      if (!filter || !filter.isActive) {
        await this.stop(userId).catch(() => undefined);
        return;
      }

      const elapsedMs = Date.now() - session.lastAppliedAt;
      if (elapsedMs < filter.delaySeconds * 1000) return; // still inside the delay window

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const appliedToday = await this.prisma.application.count({
        where: { userId, status: 'APPLIED', appliedAt: { gte: startOfToday } },
      });
      if (appliedToday >= filter.maxApplicationsPerDay) return; // daily cap reached

      const availablePlatforms = [...session.pages.keys()].filter(
        (p) => !session.rateLimitedPlatforms.has(p),
      );
      let pending = await this.prisma.application.findFirst({
        where: { userId, status: 'PENDING', platform: { in: availablePlatforms } },
        orderBy: { createdAt: 'asc' },
      });

      if (!pending) {
        // Queue is dry — periodically look for more jobs across every logged-in platform
        // instead of idling forever once the first batch is exhausted.
        const searchIntervalMs = filter.searchIntervalMinutes * 60_000;
        const sinceLastSearch = Date.now() - session.lastSearchAt;
        if (sinceLastSearch >= searchIntervalMs) {
          const queued = await this.searchAndQueue(userId, filter, session);
          session.lastSearchAt = Date.now();
          session.nextSearchAt = Date.now() + searchIntervalMs;
          this.logger.debug(`Re-search for user ${userId} queued ${queued} new job(s)`);
          pending = await this.prisma.application.findFirst({
            where: { userId, status: 'PENDING', platform: { in: availablePlatforms } },
            orderBy: { createdAt: 'asc' },
          });
        }
        if (!pending) {
          if (session.state !== 'RATE_LIMITED') session.state = 'WAITING_FOR_NEW_JOBS';
          return; // still nothing to do this tick
        }
      }

      const page = session.pages.get(pending.platform);
      const provider = this.providerRegistry.get(pending.platform);
      if (!page) {
        await this.prisma.application.update({
          where: { id: pending.id },
          data: { status: 'FAILED', errorMessage: `No active logged-in session for ${pending.platform}` },
        });
        return;
      }

      const profileRow = await this.prisma.profile.findUnique({ where: { userId } });

      session.state = 'OPENING_JOB';
      try {
        session.state = 'APPLYING';
        await provider.applyToJob(
          page,
          {
            title: pending.jobTitle,
            company: pending.company ?? undefined,
            url: pending.jobUrl,
          },
          {
            profile: toApplicantProfile(profileRow, session.resumeText),
            minMatchScore: filter.minMatchScore,
            skipRelevanceCheck: filter.directApply,
          },
        );
        await this.prisma.application.update({
          where: { id: pending.id },
          data: { status: 'APPLIED', appliedAt: new Date() },
        });
        session.lastAppliedAt = Date.now();
        session.applicationsCount++;
        session.state = 'APPLICATION_COMPLETED';
      } catch (err) {
        session.lastError = (err as Error).message;
        const { status, matchScore } = classifyApplyError(err);
        await this.prisma.application.update({
          where: { id: pending.id },
          data: { status, errorMessage: session.lastError, matchScore },
        });
        // A skip is an intentional non-failure, so it shouldn't burn the delay window the same
        // way a real applied/failed/manual-action attempt does — those actually took real time
        // interacting with the platform.
        if (status !== 'SKIPPED') session.lastAppliedAt = Date.now();

        if (status === 'MANUAL_ACTION_REQUIRED') {
          // Never keep hammering the same blocker (CAPTCHA/OTP/payment/unanswerable question) —
          // pause the whole agent and wait for the user to look at it and resume explicitly.
          session.state = 'MANUAL_ACTION_REQUIRED';
          session.paused = true;
        } else {
          session.state = 'ERROR';
        }
      }
    } finally {
      session.isTicking = false;
    }
  }

  async stop(userId: string) {
    const session = this.sessions.get(userId);
    if (!session) throw new NotFoundException('Automation is not running for this account');

    clearInterval(session.interval);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    this.sessions.delete(userId);
    return { stopped: true };
  }

  /**
   * Soft-stop: the tick loop stops picking up new work, but the browser/session stays alive
   * (still logged in) so resume() doesn't have to log back in. Used both for manual pausing and
   * automatically when the agent hits something it can't handle itself (see tick()'s
   * MANUAL_ACTION_REQUIRED branch).
   */
  pause(userId: string) {
    const session = this.sessions.get(userId);
    if (!session) throw new NotFoundException('Automation is not running for this account');
    session.paused = true;
    if (session.state !== 'MANUAL_ACTION_REQUIRED' && session.state !== 'RATE_LIMITED') {
      session.state = 'PAUSED';
    }
    return { paused: true };
  }

  resume(userId: string) {
    const session = this.sessions.get(userId);
    if (!session) throw new NotFoundException('Automation is not running for this account');
    session.paused = false;
    session.rateLimitedPlatforms.clear();
    session.state = 'SEARCHING';
    return { paused: false };
  }

  /**
   * Exposes the live logged-in Page for one platform of a running session. Returns null if
   * automation isn't running or that platform never logged in successfully.
   */
  getPage(userId: string, platform: string): Page | null {
    return this.sessions.get(userId)?.pages.get(platform) ?? null;
  }

  /**
   * Same idea as getPage, but the dedicated outreach tab (see draftOutreach/getOutreachPage
   * above) rather than the job-search/apply page — sending a connection message must not hijack
   * whatever the main automation loop is doing on the job-search tab. Returns null if automation
   * isn't running; the caller (OutreachController) surfaces that as "start automation first".
   */
  async getOutreachPageForUser(userId: string): Promise<Page | null> {
    const session = this.sessions.get(userId);
    if (!session) return null;
    return this.getOutreachPage(session);
  }

  async status(userId: string) {
    const session = this.sessions.get(userId);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [pendingCount, appliedToday] = await Promise.all([
      this.prisma.application.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.application.count({
        where: { userId, status: 'APPLIED', appliedAt: { gte: startOfToday } },
      }),
    ]);

    return {
      running: !!session,
      paused: session?.paused ?? false,
      state: session?.state ?? 'STOPPED',
      platformsLoggedIn: session ? [...session.pages.keys()] : [],
      rateLimitedPlatforms: session ? [...session.rateLimitedPlatforms] : [],
      platformErrors: session?.platformErrors ?? {},
      pendingCount,
      appliedToday,
      lastError: session?.lastError,
      uptimeMs: session ? Date.now() - session.startedAt : 0,
      jobsScanned: session?.jobsScanned ?? 0,
      newJobsFound: session?.newJobsFound ?? 0,
      applicationsCount: session?.applicationsCount ?? 0,
      nextSearchAt: session?.nextSearchAt ?? null,
    };
  }
}
