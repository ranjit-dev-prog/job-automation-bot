import { BadRequestException, Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MailService } from './mail.service';
import { MailCredentialsService } from './mail-credentials.service';
import { SendMailDto } from './dto/send-mail.dto';
import { SaveMailCredentialDto } from './dto/save-mail-credential.dto';

/**
 * Guarded the same as every other authenticated route in this app — a public unauthenticated
 * "send arbitrary email" endpoint would be an open relay/spam vector, so this is deliberately
 * behind login, not a demo you'd expose as-is on a public API.
 */
@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly mailCredentials: MailCredentialsService,
  ) {}

  @Get('credentials')
  getCredentialStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.mailCredentials.status(user.userId);
  }

  @Post('credentials')
  saveCredential(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveMailCredentialDto) {
    return this.mailCredentials.save(user.userId, dto);
  }

  @Delete('credentials')
  removeCredential(@CurrentUser() user: AuthenticatedUser) {
    return this.mailCredentials.remove(user.userId);
  }

  @Post('send')
  async send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendMailDto) {
    if (!dto.to?.length && !dto.bcc?.length) {
      throw new BadRequestException('Provide at least one of `to` or `bcc`.');
    }
    try {
      return await this.mailService.sendMail({
        to: dto.to,
        bcc: dto.bcc,
        cc: dto.cc,
        subject: dto.subject,
        text: dto.text,
        userId: user.userId,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
