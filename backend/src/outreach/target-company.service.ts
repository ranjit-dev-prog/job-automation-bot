import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { domainFromEmailOrCompany, guessCompanyEmail, guessRoleEmails } from './email-guess.util';
import { hasMxRecords, scrapeCompanyEmail } from './email-scraper.util';
import { buildOutreachEmail } from './outreach-templates.util';
import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';
import { CreateTargetCompanyDto } from './dto/create-target-company.dto';
import { UpdateTargetCompanyDto } from './dto/update-target-company.dto';

function splitList(csv: string | null | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A user-curated list of companies to email directly — separate from the outreach that's
 * auto-drafted off job postings found during automation. Adding a company here never sends
 * anything by itself; drafting (draftAll) and sending both still require explicit action, same
 * as the rest of Outreach.
 */
@Injectable()
export class TargetCompanyService {
  private readonly logger = new Logger(TargetCompanyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  create(userId: string, dto: CreateTargetCompanyDto) {
    return this.prisma.targetCompany.create({
      data: {
        userId,
        companyName: dto.companyName,
        email: dto.email?.trim() || guessCompanyEmail(dto.companyName),
        emailSource: dto.email?.trim() ? 'manual' : 'guessed',
        contactName: dto.contactName,
        roleOfInterest: dto.roleOfInterest,
        notes: dto.notes,
      },
    });
  }

  async bulkCreate(userId: string, rows: CreateTargetCompanyDto[]): Promise<{ created: number }> {
    const data = rows
      .filter((r) => r.companyName?.trim())
      .map((r) => ({
        userId,
        companyName: r.companyName.trim(),
        email: r.email?.trim() || guessCompanyEmail(r.companyName),
        emailSource: r.email?.trim() ? 'manual' : 'guessed',
        contactName: r.contactName || undefined,
        roleOfInterest: r.roleOfInterest || undefined,
        notes: r.notes || undefined,
      }));
    const result = await this.prisma.targetCompany.createMany({ data });
    return { created: result.count };
  }

  list(userId: string) {
    return this.prisma.targetCompany.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  async update(userId: string, id: string, dto: UpdateTargetCompanyDto) {
    const row = await this.prisma.targetCompany.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Company not found');
    if (row.userId !== userId) throw new ForbiddenException();
    // A hand-edited email is authoritative — mark it "manual" so a later scrape run never
    // overwrites the user's own correction.
    return this.prisma.targetCompany.update({
      where: { id },
      data: { ...dto, ...(dto.email ? { emailSource: 'manual' } : {}) },
    });
  }

  async remove(userId: string, id: string) {
    const row = await this.prisma.targetCompany.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Company not found');
    if (row.userId !== userId) throw new ForbiddenException();
    await this.prisma.targetCompany.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Wipes the whole list. Any OutreachEmail rows already drafted/sent from these companies are
   * kept (their targetCompanyId just goes null via the schema's onDelete: SetNull) — this only
   * clears the source list, not outreach history.
   */
  async removeAll(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.targetCompany.deleteMany({ where: { userId } });
    return { deleted: result.count };
  }

  /**
   * Concurrency for scraping — these are plain HTTPS fetches to arbitrary third-party sites, not
   * a rate-sensitive provider like Gmail, so a larger pool than the mail-send one is fine.
   */
  private static readonly SCRAPE_CONCURRENCY = 8;

  /**
   * Tries to resolve one company's real email, updating the row and returning the address to use
   * plus how it was resolved. Shared by scrapeEmails (bulk, on demand) and draftAll (inline, so a
   * first-time draft uses the best address available instead of the raw guess) — both need the
   * identical fetch-then-persist step.
   */
  private async scrapeOneCompany(
    company: { id: string; email: string; companyName: string },
  ): Promise<{ email: string; source: 'scraped' | 'not_found' | 'invalid_domain' }> {
    const domain = domainFromEmailOrCompany(company.email, company.companyName);
    const found = await scrapeCompanyEmail(domain).catch(() => null);
    if (found) {
      await this.prisma.targetCompany.update({ where: { id: company.id }, data: { email: found, emailSource: 'scraped' } });
      return { email: found, source: 'scraped' };
    }
    // No HR-looking address was found on the site, but that alone doesn't mean the guessed
    // hr@domain is even reachable — a domain with no mail exchanger at all will hard-bounce
    // regardless of the local part. Flagging that distinctly (rather than lumping it in with
    // "just unverified") tells the user which guesses are worth fixing by hand before sending.
    const domainCanReceiveMail = await hasMxRecords(domain).catch(() => false);
    const source = domainCanReceiveMail ? 'not_found' : 'invalid_domain';
    await this.prisma.targetCompany.update({ where: { id: company.id }, data: { emailSource: source } });
    return { email: company.email, source };
  }

  /**
   * Best-effort real-email lookup for companies still on the guessed hr@domain fallback: fetches
   * each one's likely homepage/contact/careers pages and looks for a published address on that
   * domain. Only touches rows still marked "guessed" so re-running doesn't re-fetch companies
   * already resolved (or already confirmed to have nothing findable) — never overwrites an email
   * the user edited by hand, since editing a row doesn't reset emailSource back to "guessed".
   */
  async scrapeEmails(
    userId: string,
    limit = 100,
  ): Promise<{ scraped: number; notFound: number; invalidDomain: number; attempted: number }> {
    const pending = await this.prisma.targetCompany.findMany({
      where: { userId, emailSource: 'guessed' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let scraped = 0;
    let notFound = 0;
    let invalidDomain = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length) {
        const company = pending[cursor++];
        const { source } = await this.scrapeOneCompany(company);
        if (source === 'scraped') scraped++;
        else if (source === 'invalid_domain') invalidDomain++;
        else notFound++;
      }
    };

    const poolSize = Math.min(TargetCompanyService.SCRAPE_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: poolSize }, worker));

    this.logger.log(
      `Scraped emails for ${scraped}/${pending.length} target companies for user ${userId} ` +
        `(${notFound} not found, ${invalidDomain} invalid domain)`,
    );
    return { scraped, notFound, invalidDomain, attempted: pending.length };
  }

  /**
   * Drafts an outreach email for every not-yet-drafted company on the list — never sends by
   * itself (see draftAndSendAll in the controller for the combined flow). Skips rows already
   * drafted (draftedAt set) so re-running doesn't create duplicates. `limit`, when given, caps how
   * many get drafted in this call; omit it to process every pending company. Concurrency-limited
   * the same way as scrapeEmails/sendSelected, since each company independently does a scrape
   * fetch plus an AI drafting call — sequential would make a large pending list take far too long.
   */
  async draftAll(userId: string, limit?: number): Promise<{ drafted: number; emailIds: string[] }> {
    const profileRow = await this.prisma.profile.findUnique({ where: { userId } });
    const profile: ApplicantProfile = profileRow ?? {};

    const pending = await this.prisma.targetCompany.findMany({
      where: { userId, draftedAt: null },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });

    const emailIds: string[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length) {
        const company = pending[cursor++];

        // Scrape for a real address before drafting the first time — a company already resolved
        // ("scraped"/"not_found"/"invalid_domain") or hand-edited ("manual") is left alone; only a
        // still-unchecked guess gets one scrape attempt here, so drafting no longer requires a
        // separate manual step.
        let toEmail = company.email;
        let emailSource = company.emailSource;
        if (company.emailSource === 'guessed') {
          const resolved = await this.scrapeOneCompany(company);
          toEmail = resolved.email;
          emailSource = resolved.source;
        }

        const role = company.roleOfInterest?.trim() || splitList(profile.targetRoles)[0] || null;

        const aiDraft = await this.ai
          .draftOutreachEmail(profile, role ?? 'roles you may be hiring for', company.companyName)
          .catch(() => null);
        const { subject, body } =
          aiDraft ?? buildOutreachEmail(profile, role ?? 'roles you may be hiring for', company.companyName);

        const ccEmails = guessRoleEmails(domainFromEmailOrCompany(toEmail, company.companyName)).join(',');

        const created = await this.prisma.outreachEmail.create({
          data: {
            userId,
            targetCompanyId: company.id,
            company: company.companyName,
            toEmail,
            emailSource,
            ccEmails,
            subject,
            body,
          },
        });
        await this.prisma.targetCompany.update({ where: { id: company.id }, data: { draftedAt: new Date() } });
        emailIds.push(created.id);
      }
    };

    const poolSize = Math.min(TargetCompanyService.SCRAPE_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: poolSize }, worker));

    this.logger.log(
      `Drafted outreach for ${emailIds.length} target compan${emailIds.length === 1 ? 'y' : 'ies'} for user ${userId}`,
    );
    return { drafted: emailIds.length, emailIds };
  }
}
