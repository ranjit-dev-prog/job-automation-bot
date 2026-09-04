import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MailService as GmailMailService } from '../mail/mail.service';
import { resolveSmtpHost } from '../mail/smtp-host-resolver.util';

export interface OutgoingMail {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  attachmentPath?: string | null;
  /** Whose saved Gmail credential (if any) to send as — see mail/mail.service.ts. */
  userId?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Sends outreach emails via either a transactional email API (Resend) or plain SMTP, chosen by
 * EMAIL_PROVIDER. Defaults to "none" — isConfigured() is false and send() fails fast with a
 * clear "not configured" error instead of silently doing nothing.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: string;
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly gmailMailService: GmailMailService,
  ) {
    this.provider = (this.config.get<string>('EMAIL_PROVIDER', 'none') || 'none').toLowerCase();
  }

  /**
   * `userId`, when passed, also counts a per-user saved Gmail credential (set from the Outreach
   * page) as "configured" — not just the shared .env vars. Without it, this only reflects the
   * server-wide .env config, which is why send() always passes mail.userId through here.
   */
  async isConfigured(userId?: string): Promise<boolean> {
    if (this.provider === 'resend') return !!this.config.get<string>('RESEND_API_KEY');
    if (this.provider === 'gmail') return this.gmailMailService.isConfiguredFor(userId);
    if (this.provider === 'smtp') {
      return !!(
        this.config.get<string>('SMTP_HOST') &&
        this.config.get<string>('SMTP_USER') &&
        this.config.get<string>('SMTP_PASS')
      );
    }
    return false;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!(await this.isConfigured(mail.userId))) {
      throw new Error(
        'Email sending is not configured — save a Gmail App Password on the Outreach page, or ' +
          'set EMAIL_PROVIDER and the matching credentials in backend/.env.',
      );
    }
    if (this.provider === 'resend') return this.sendViaResend(mail);
    if (this.provider === 'gmail') return this.sendViaGmail(mail);
    return this.sendViaSmtp(mail);
  }

  private async sendViaGmail(mail: OutgoingMail): Promise<void> {
    const attachments = mail.attachmentPath ? [{ filename: basename(mail.attachmentPath), path: mail.attachmentPath }] : undefined;
    await this.gmailMailService.sendMail({
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      text: mail.body,
      attachments,
      userId: mail.userId,
    });
    this.logger.log(`Sent outreach email to ${mail.to} via Gmail`);
  }

  private async sendViaResend(mail: OutgoingMail): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const fromEmail = this.config.get<string>('RESEND_FROM_EMAIL', 'onboarding@resend.dev');
    const fromName = this.config.get<string>('RESEND_FROM_NAME');

    const attachments = mail.attachmentPath
      ? [
          {
            filename: basename(mail.attachmentPath),
            content: (await readFile(mail.attachmentPath)).toString('base64'),
          },
        ]
      : undefined;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        to: [mail.to],
        cc: mail.cc,
        subject: mail.subject,
        text: mail.body,
        attachments,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend API returned ${res.status}: ${detail}`);
    }
    this.logger.log(`Sent outreach email to ${mail.to} via Resend`);
  }

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('SMTP_HOST', '');
    this.transporter = nodemailer.createTransport({
      ...(await resolveSmtpHost(host)),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  private async sendViaSmtp(mail: OutgoingMail): Promise<void> {
    const fromAddress = this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER');
    const fromName = this.config.get<string>('SMTP_FROM_NAME');
    const transporter = await this.getTransporter();

    await transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      text: mail.body,
      attachments: mail.attachmentPath ? [{ path: mail.attachmentPath }] : undefined,
    });
    this.logger.log(`Sent outreach email to ${mail.to} via SMTP`);
  }
}
