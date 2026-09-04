import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { buildConnectionMessage } from './outreach-templates.util';
import { ApplicantProfile } from '../automation/interfaces/job-platform-provider.interface';
import { UpdateConnectionMessageDto } from './dto/update-connection-message.dto';

const MAX_CONNECTIONS_PER_JOB = 3; // a handful of drafts, not a blast to every 1st-degree contact at the company

/**
 * Drafts and (on explicit approval) sends referral-ask messages to 1st-degree LinkedIn
 * connections at a job's company. Deliberately has no Playwright/LinkedIn dependency of its
 * own — the caller (AutomationService, which already owns the live browser session) looks up
 * connections and performs the actual send; this service only owns the DB rows and content
 * generation, which keeps it decoupled from the automation module.
 *
 * Drafting happens automatically when a filter has connectionOutreachEnabled and connections are
 * found — sending never does. Every draft sits as DRAFT until approved from the Outreach queue.
 */
@Injectable()
export class ConnectionMessageService {
  private readonly logger = new Logger(ConnectionMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async draftForApplication(
    userId: string,
    application: { id: string; jobTitle: string; company: string | null },
    profile: ApplicantProfile,
    connections: { name: string; profileUrl: string }[],
  ): Promise<void> {
    if (!application.company) return;

    for (const connection of connections.slice(0, MAX_CONNECTIONS_PER_JOB)) {
      const aiMessage = await this.ai
        .draftConnectionMessage(profile, application.jobTitle, application.company, connection.name)
        .catch(() => null);
      const message =
        aiMessage ?? buildConnectionMessage(profile, application.jobTitle, application.company, connection.name);

      await this.prisma.connectionMessage.create({
        data: {
          userId,
          applicationId: application.id,
          company: application.company,
          connectionName: connection.name,
          connectionProfileUrl: connection.profileUrl,
          message,
        },
      });
    }
  }

  list(userId: string, status?: string) {
    return this.prisma.connectionMessage.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Lets the user rewrite the generated draft before approving it — only while it's still DRAFT. */
  async update(userId: string, id: string, dto: UpdateConnectionMessageDto) {
    const draft = await this.prisma.connectionMessage.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.userId !== userId) throw new ForbiddenException();
    if (draft.status !== 'DRAFT') {
      throw new ForbiddenException('Only un-sent drafts can be edited');
    }
    return this.prisma.connectionMessage.update({
      where: { id },
      data: { message: dto.message },
    });
  }

  async sendSelected(
    userId: string,
    ids: string[],
    sendMessage: (profileUrl: string, message: string) => Promise<void>,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const id of ids) {
      const draft = await this.prisma.connectionMessage.findUnique({ where: { id } });
      if (draft?.userId !== userId || draft?.status !== 'DRAFT') continue;

      try {
        await sendMessage(draft.connectionProfileUrl, draft.message);
        await this.prisma.connectionMessage.update({
          where: { id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        await this.logAttempt(userId, id, draft.connectionProfileUrl, 'SUCCESS');
        sent++;
      } catch (err) {
        const message = (err as Error).message;
        this.logger.warn(`Failed to send connection message ${id}: ${message}`);
        await this.prisma.connectionMessage.update({
          where: { id },
          data: { status: 'FAILED', errorMessage: message },
        });
        await this.logAttempt(userId, id, draft.connectionProfileUrl, 'FAILED', message);
        failed++;
      }
    }
    return { sent, failed };
  }

  private logAttempt(
    userId: string,
    connectionMessageId: string,
    recipient: string,
    result: 'SUCCESS' | 'FAILED',
    errorMessage?: string,
  ) {
    return this.prisma.outreachLog.create({
      data: { userId, channel: 'LINKEDIN_MESSAGE', connectionMessageId, recipient, result, errorMessage },
    });
  }
}
