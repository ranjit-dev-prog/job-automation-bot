import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MailService } from './mail.service';
import { domainFromEmailOrCompany, guessCompanyEmail, guessRoleEmails } from './email-guess.util';
import { buildOutreachEmail } from './outreach-templates.util';
import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';
import { UpdateOutreachEmailDto } from './dto/update-outreach-email.dto';
import { CreateOutreachEmailDto } from './dto/create-outreach-email.dto';

/**
 * Drafts and (on explicit approval) sends HR-outreach emails. Drafting always happens
 * automatically when a filter has emailOutreachEnabled — sending never does. Every draft sits as
 * DRAFT until the user selects it in the Outreach queue and hits Send; nothing reaches a real
 * inbox unattended, since toEmail is a best-effort guess, not a verified address.
 */
@Injectable()
export class OutreachEmailService {
  private readonly logger = new Logger(OutreachEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly mail: MailService,
  ) {}

  async draftForApplication(
    userId: string,
    application: { id: string; jobTitle: string; company: string | null },
    profile: ApplicantProfile,
  ): Promise<void> {
    if (!application.company) return; // nothing sensible to guess an address from

    const aiDraft = await this.ai.draftOutreachEmail(profile, application.jobTitle, application.company).catch(() => null);
    const { subject, body } = aiDraft ?? buildOutreachEmail(profile, application.jobTitle, application.company);

    const toEmail = guessCompanyEmail(application.company);
    const ccEmails = guessRoleEmails(domainFromEmailOrCompany(toEmail, application.company)).join(',');

    await this.prisma.outreachEmail.create({
      data: {
        userId,
        applicationId: application.id,
        company: application.company,
        toEmail,
        ccEmails,
        subject,
        body,
      },
    });
  }

  list(userId: string, status?: string) {
    return this.prisma.outreachEmail.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  }

  /** Lets the user rewrite a draft — while it's still DRAFT, or to fix a FAILED one before retrying. */
  async update(userId: string, id: string, dto: UpdateOutreachEmailDto) {
    const draft = await this.prisma.outreachEmail.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.userId !== userId) throw new ForbiddenException();
    if (draft.status !== 'DRAFT' && draft.status !== 'FAILED') {
      throw new ForbiddenException('Only un-sent or failed drafts can be edited');
    }
    return this.prisma.outreachEmail.update({
      where: { id },
      data: {
        subject: dto.subject,
        body: dto.body,
        toEmail: dto.toEmail,
        ccEmails: dto.ccEmails,
        // A hand-edited "to" address is authoritative, same treatment as a hand-edited target
        // company email — never leave it looking like an unreviewed guess.
        ...(dto.toEmail ? { emailSource: 'manual' } : {}),
      },
    });
  }

  /** Manually composed draft — not tied to an application or target-company row. */
  async createManual(userId: string, dto: CreateOutreachEmailDto) {
    return this.prisma.outreachEmail.create({
      data: {
        userId,
        company: dto.company,
        toEmail: dto.toEmail,
        emailSource: 'manual',
        ccEmails: dto.ccEmails || null,
        subject: dto.subject,
        body: dto.body,
        attachResume: dto.attachResume ?? true,
      },
    });
  }

  /**
   * Deletes every un-sent-successfully email — DRAFT and FAILED both (never SENT — that's real
   * history, not a mistake to clean up). If a row came from the target-companies list, that
   * company's draftedAt is cleared too, so "Draft next batch" can pick it up again instead of it
   * being stuck marked-drafted with the row gone.
   */
  async deleteAllDrafts(userId: string): Promise<{ deleted: number }> {
    const drafts = await this.prisma.outreachEmail.findMany({
      where: { userId, status: { in: ['DRAFT', 'FAILED'] } },
      select: { id: true, targetCompanyId: true },
    });
    if (drafts.length === 0) return { deleted: 0 };

    const targetCompanyIds = drafts.map((d) => d.targetCompanyId).filter((id): id is string => !!id);
    await this.prisma.$transaction([
      this.prisma.outreachEmail.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } }),
      ...(targetCompanyIds.length
        ? [
            this.prisma.targetCompany.updateMany({
              where: { id: { in: targetCompanyIds } },
              data: { draftedAt: null },
            }),
          ]
        : []),
    ]);
    return { deleted: drafts.length };
  }

  /**
   * Dispatch-level concurrency. Forced to 1 (fully serial) for now: this Gmail account has been
   * repeatedly flagged today, to the point that even 2-3 simultaneous pooled connections
   * retrigger a "too many login attempts" lockout, while a single isolated send keeps succeeding.
   * Matches mail.service.ts's maxConnections: 1 — see that file's comment. Revisit raising this
   * once the account's flagged state has settled (a clean day of normal-volume sending).
   */
  private static readonly SEND_CONCURRENCY = 1;

  /** Gap between sends when running serially — gentler than back-to-back, negligible for total time at CONCURRENCY=1. */
  private static readonly SEND_GAP_MS = 800;

  /**
   * A batch-wide Gmail failure (daily quota exceeded, or the account's SMTP login temporarily
   * locked out) will fail identically for every remaining draft — continuing to iterate through
   * hundreds more only wastes time and, worse, each attempt is another forced reconnect that can
   * deepen the lockout. Stop the whole batch the moment either shows up; untouched drafts are
   * left exactly as they were (still DRAFT/FAILED) for a later retry once the block clears.
   */
  private static readonly BATCH_FATAL_PATTERN = /Daily user sending limit exceeded|Too many login attempts/i;

  async sendSelected(userId: string, ids: string[]): Promise<{ sent: number; failed: number; stoppedEarly: boolean }> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const resumePath = profile?.resumePath ?? null;

    const drafts = await this.prisma.outreachEmail.findMany({
      where: { id: { in: ids }, userId, status: { in: ['DRAFT', 'FAILED'] } },
    });

    let sent = 0;
    let failed = 0;
    let cursor = 0;
    let abort = false;

    const sendOne = async (draft: (typeof drafts)[number]) => {
      try {
        await this.mail.send({
          userId,
          to: draft.toEmail,
          cc: draft.ccEmails
            ? draft.ccEmails.split(',').map((e) => e.trim()).filter(Boolean)
            : undefined,
          subject: draft.subject,
          body: draft.body,
          attachmentPath: draft.attachResume ? resumePath : null,
        });
        await this.prisma.outreachEmail.update({
          where: { id: draft.id },
          data: { status: 'SENT', sentAt: new Date(), errorMessage: null },
        });
        await this.logAttempt(userId, draft.id, draft.toEmail, draft.subject, 'SUCCESS');
        sent++;
      } catch (err) {
        const message = (err as Error).message;
        this.logger.warn(`Failed to send outreach email ${draft.id}: ${message}`);
        await this.prisma.outreachEmail.update({
          where: { id: draft.id },
          data: { status: 'FAILED', errorMessage: message },
        });
        await this.logAttempt(userId, draft.id, draft.toEmail, draft.subject, 'FAILED', message);
        failed++;
        if (OutreachEmailService.BATCH_FATAL_PATTERN.test(message)) {
          this.logger.warn(`Stopping outreach send batch early — Gmail-side block detected (${failed} attempted, ${drafts.length - cursor} left untouched)`);
          abort = true;
        }
      }
    };

    const worker = async () => {
      while (cursor < drafts.length && !abort) {
        const draft = drafts[cursor++];
        await sendOne(draft);
        if (!abort && OutreachEmailService.SEND_CONCURRENCY === 1) {
          await new Promise((resolve) => setTimeout(resolve, OutreachEmailService.SEND_GAP_MS));
        }
      }
    };

    const poolSize = Math.min(OutreachEmailService.SEND_CONCURRENCY, drafts.length);
    await Promise.all(Array.from({ length: poolSize }, worker));

    return { sent, failed, stoppedEarly: abort };
  }

  private logAttempt(
    userId: string,
    outreachEmailId: string,
    recipient: string,
    subject: string,
    result: 'SUCCESS' | 'FAILED',
    errorMessage?: string,
  ) {
    return this.prisma.outreachLog.create({
      data: { userId, channel: 'EMAIL', outreachEmailId, recipient, subject, result, errorMessage },
    });
  }
}
