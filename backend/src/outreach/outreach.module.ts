import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MailModule } from '../mail/mail.module';
import { OutreachEmailService } from './outreach-email.service';
import { ConnectionMessageService } from './connection-message.service';
import { OutreachLogService } from './outreach-log.service';
import { TargetCompanyService } from './target-company.service';
import { MailService } from './mail.service';

/**
 * Deliberately has no dependency on AutomationModule — these services only own DB rows and
 * content generation (email via MailService directly; connection messages take a pre-found
 * connection list / send callback from the caller). AutomationModule imports this module (not
 * the other way around) so its LinkedIn-session-owning code can trigger drafts/sends without a
 * circular module dependency.
 */
@Module({
  imports: [AiModule, MailModule],
  providers: [OutreachEmailService, ConnectionMessageService, OutreachLogService, TargetCompanyService, MailService],
  exports: [OutreachEmailService, ConnectionMessageService, OutreachLogService, TargetCompanyService],
})
export class OutreachModule {}
