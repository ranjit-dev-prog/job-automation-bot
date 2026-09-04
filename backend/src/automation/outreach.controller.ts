import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { OutreachEmailService } from '../outreach/outreach-email.service';
import { ConnectionMessageService } from '../outreach/connection-message.service';
import { OutreachLogService } from '../outreach/outreach-log.service';
import { TargetCompanyService } from '../outreach/target-company.service';
import { SendOutreachDto } from '../outreach/dto/send-outreach.dto';
import { UpdateOutreachEmailDto } from '../outreach/dto/update-outreach-email.dto';
import { CreateOutreachEmailDto } from '../outreach/dto/create-outreach-email.dto';
import { UpdateConnectionMessageDto } from '../outreach/dto/update-connection-message.dto';
import { CreateTargetCompanyDto } from '../outreach/dto/create-target-company.dto';
import { BulkCreateTargetCompaniesDto } from '../outreach/dto/bulk-create-target-companies.dto';
import { UpdateTargetCompanyDto } from '../outreach/dto/update-target-company.dto';
import { AutomationService } from './automation.service';
import { LinkedInProvider } from './providers/linkedin.provider';

/**
 * Lives in AutomationModule (not OutreachModule) because sending — unlike drafting — needs the
 * live logged-in LinkedIn Page a running automation session owns, plus LinkedInProvider.sendMessage.
 * Putting it here avoids a circular dependency between AutomationModule and OutreachModule.
 */
@Controller('outreach')
@UseGuards(JwtAuthGuard)
export class OutreachController {
  constructor(
    private readonly outreachEmailService: OutreachEmailService,
    private readonly connectionMessageService: ConnectionMessageService,
    private readonly outreachLogService: OutreachLogService,
    private readonly targetCompanyService: TargetCompanyService,
    private readonly automationService: AutomationService,
    private readonly linkedIn: LinkedInProvider,
  ) {}

  @Get('target-companies')
  listTargetCompanies(@CurrentUser() user: AuthenticatedUser) {
    return this.targetCompanyService.list(user.userId);
  }

  @Post('target-companies')
  createTargetCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTargetCompanyDto) {
    return this.targetCompanyService.create(user.userId, dto);
  }

  @Post('target-companies/bulk')
  bulkCreateTargetCompanies(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkCreateTargetCompaniesDto) {
    return this.targetCompanyService.bulkCreate(user.userId, dto.companies);
  }

  @Patch('target-companies/:id')
  updateTargetCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTargetCompanyDto,
  ) {
    return this.targetCompanyService.update(user.userId, id, dto);
  }

  @Delete('target-companies')
  removeAllTargetCompanies(@CurrentUser() user: AuthenticatedUser) {
    return this.targetCompanyService.removeAll(user.userId);
  }

  @Delete('target-companies/:id')
  removeTargetCompany(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.targetCompanyService.remove(user.userId, id);
  }

  @Post('target-companies/draft')
  draftTargetCompanies(@CurrentUser() user: AuthenticatedUser, @Body('limit') limit?: number) {
    return this.targetCompanyService.draftAll(user.userId, limit && limit > 0 ? limit : undefined);
  }

  /**
   * Drafts every pending company (scraping for a real address first, same as draftAll) and, as
   * soon as each is drafted, sends it immediately — no separate review/select step. This is a
   * deliberately more dangerous action than the rest of Outreach (which always stops at DRAFT for
   * manual approval): only use it when you're confident in the address quality and content, since
   * mistakes reach real inboxes before you get a chance to catch them.
   */
  @Post('target-companies/draft-and-send')
  async draftAndSendAll(@CurrentUser() user: AuthenticatedUser) {
    const { drafted, emailIds } = await this.targetCompanyService.draftAll(user.userId);
    if (emailIds.length === 0) return { drafted: 0, sent: 0, failed: 0 };
    const { sent, failed } = await this.outreachEmailService.sendSelected(user.userId, emailIds);
    return { drafted, sent, failed };
  }

  @Post('target-companies/scrape-emails')
  scrapeTargetCompanyEmails(@CurrentUser() user: AuthenticatedUser, @Body('limit') limit?: number) {
    return this.targetCompanyService.scrapeEmails(user.userId, limit && limit > 0 ? limit : 100);
  }

  @Get('logs')
  listLogs(@CurrentUser() user: AuthenticatedUser, @Query('channel') channel?: string) {
    return this.outreachLogService.list(user.userId, channel);
  }

  @Get('emails')
  listEmails(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.outreachEmailService.list(user.userId, status);
  }

  @Post('emails')
  createEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOutreachEmailDto) {
    return this.outreachEmailService.createManual(user.userId, dto);
  }

  @Patch('emails/:id')
  updateEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOutreachEmailDto,
  ) {
    return this.outreachEmailService.update(user.userId, id, dto);
  }

  @Post('emails/send')
  async sendEmails(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendOutreachDto) {
    return this.outreachEmailService.sendSelected(user.userId, dto.ids);
  }

  @Delete('emails')
  deleteAllEmailDrafts(@CurrentUser() user: AuthenticatedUser) {
    return this.outreachEmailService.deleteAllDrafts(user.userId);
  }

  @Get('connection-messages')
  listConnectionMessages(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.connectionMessageService.list(user.userId, status);
  }

  @Patch('connection-messages/:id')
  updateConnectionMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConnectionMessageDto,
  ) {
    return this.connectionMessageService.update(user.userId, id, dto);
  }

  @Post('connection-messages/send')
  async sendConnectionMessages(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendOutreachDto) {
    const page = await this.automationService.getOutreachPageForUser(user.userId);
    if (!page) {
      throw new BadRequestException(
        'Automation needs to be running with LinkedIn logged in to send connection messages — start it first.',
      );
    }
    return this.connectionMessageService.sendSelected(user.userId, dto.ids, (profileUrl, message) =>
      this.linkedIn.sendMessage(page, profileUrl, message),
    );
  }
}
