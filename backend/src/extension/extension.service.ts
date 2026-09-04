import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ResumeParserService } from '../profile/resume-parser.service';
import { computeMatchScore } from '../automation/job-matching.util';
import { answerScreeningQuestion } from '../automation/screening-answer.util';
import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';
import { ReportApplicationDto } from './dto/report-application.dto';

/**
 * Backs the Chrome extension's apply-automation: the extension's content script does the actual
 * DOM work (search LinkedIn, click Easy Apply, fill the form) in the user's own logged-in tab —
 * this service supplies the same "intelligence" the Playwright-based bot uses (profile data,
 * relevance scoring, screening-question answers) and records the same Application rows, so both
 * automation paths write to identical data and the rest of the app (dashboard, stats) can't tell
 * which one applied to a given job.
 */
@Injectable()
export class ExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly resumeParser: ResumeParserService,
  ) {}

  private async loadProfile(userId: string): Promise<ApplicantProfile> {
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    const resumeText = row?.resumePath ? await this.resumeParser.extractText(row.resumePath).catch(() => null) : null;
    if (!row) return { resumeText };
    return {
      fullName: row.fullName,
      phone: row.phone,
      skills: row.skills,
      targetRoles: row.targetRoles,
      experienceYears: row.experienceYears,
      relevantExperienceYears: row.relevantExperienceYears,
      currentCompany: row.currentCompany,
      currentJobTitle: row.currentJobTitle,
      currentLocation: row.currentLocation,
      preferredLocation: row.preferredLocation,
      linkedinUrl: row.linkedinUrl,
      noticePeriodDays: row.noticePeriodDays,
      currentSalary: row.currentSalary,
      expectedSalary: row.expectedSalary,
      workAuthorization: row.workAuthorization,
      willingToRelocate: row.willingToRelocate,
      resumeText,
    };
  }

  private async countAppliedToday(userId: string): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return this.prisma.application.count({
      where: { userId, status: 'APPLIED', appliedAt: { gte: startOfToday } },
    });
  }

  private activeFilter(userId: string) {
    return this.prisma.jobFilter.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Everything the extension needs to run one search+apply session: the profile to answer
   * questions from, the active filter's search/limit settings, how many applications have already
   * gone out today (the extension enforces maxApplicationsPerDay client-side, same rule the
   * Playwright bot enforces server-side), and every job URL already attempted so the content
   * script can skip duplicates without a network round-trip per listing.
   */
  async getContext(userId: string) {
    const [profile, filter, appliedToday, recent] = await Promise.all([
      this.loadProfile(userId),
      this.activeFilter(userId),
      this.countAppliedToday(userId),
      this.prisma.application.findMany({
        where: { userId, platform: 'LINKEDIN' },
        select: { jobUrl: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    return {
      profile,
      filter: filter
        ? {
            keywords: filter.keywords,
            location: filter.location,
            remoteOnly: filter.remoteOnly,
            easyApplyOnly: filter.easyApplyOnly,
            minMatchScore: filter.minMatchScore,
            directApply: filter.directApply,
            delaySeconds: filter.delaySeconds,
            searchIntervalMinutes: filter.searchIntervalMinutes,
            maxApplicationsPerDay: filter.maxApplicationsPerDay,
          }
        : null,
      appliedToday,
      recentUrls: recent.map((r) => r.jobUrl),
    };
  }

  /** Same scoring logic as LinkedInProvider.scoreRelevance — AI when configured, keyword fallback otherwise. */
  async scoreRelevance(userId: string, jobTitle: string, jobDescription: string) {
    const profile = await this.loadProfile(userId);
    const keywordScore = computeMatchScore(profile, jobTitle, jobDescription);
    if (!this.ai.isEnabled()) return { score: keywordScore, source: 'keyword' as const };

    const aiResult = await this.ai.scoreRelevance(profile, jobTitle, jobDescription).catch(() => null);
    if (!aiResult) return { score: keywordScore, source: 'keyword' as const };
    return { score: aiResult.score, source: 'ai' as const };
  }

  /** Same resolution order as LinkedInProvider.resolveAnswer — AI first, deterministic rules as fallback. */
  async answerQuestion(userId: string, question: string) {
    const profile = await this.loadProfile(userId);
    if (this.ai.isEnabled()) {
      const aiAnswer = await this.ai.answerQuestion(profile, question).catch(() => null);
      if (aiAnswer) {
        const kind = /^(yes|no)$/i.test(aiAnswer.value) ? ('boolean' as const) : ('text' as const);
        return { kind, value: aiAnswer.value };
      }
    }
    return answerScreeningQuestion(profile, question);
  }

  async reportApplication(userId: string, dto: ReportApplicationDto) {
    const filter = await this.activeFilter(userId);
    return this.prisma.application.create({
      data: {
        userId,
        filterId: filter?.id,
        platform: 'LINKEDIN',
        jobTitle: dto.jobTitle,
        company: dto.company,
        jobUrl: dto.jobUrl,
        status: dto.status,
        matchScore: dto.matchScore,
        errorMessage: dto.errorMessage,
        appliedAt: dto.status === 'APPLIED' ? new Date() : undefined,
      },
    });
  }
}
