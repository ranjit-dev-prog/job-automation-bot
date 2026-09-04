import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createHash } from 'node:crypto';
import { MailCredentialsService } from './mail-credentials.service';
import { resolveSmtpHost } from './smtp-host-resolver.util';

export interface SendMailOptions {
  /**
   * Recipients on the visible "To" line — everyone in this array can see everyone else's
   * address. For a mail-merge-style send to many unrelated people, put them in `bcc` instead
   * (see the module doc comment / the class doc below) and leave `to` as a single address
   * (commonly your own, or omitted so `to` falls back to the configured sender).
   */
  to?: string | string[];
  bcc?: string | string[];
  cc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; path?: string; content?: Buffer | string }[];
  /**
   * When set, sends using that user's own saved Gmail credential (from the Outreach page)
   * instead of the shared GMAIL_USER/GMAIL_APP_PASSWORD in .env, if they've saved one. Falls
   * back to the .env-configured shared transport otherwise.
   */
  userId?: string;
}

export interface SendMailResult {
  success: true;
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Thin wrapper around @nestjs-modules/mailer's MailerService, configured for Gmail SMTP by
 * MailModule. Every send goes through here so callers never touch nodemailer/credentials
 * directly.
 *
 * Multi-recipient guidance (see also the README section this mirrors):
 * - Everyone should see each other (a real group thread) → pass an array in `to`.
 * - Sending the same content to a list of people who should NOT see each other's addresses
 *   (e.g. a batch of separate companies) → put them in `bcc`, and set `to` to your own address
 *   (or leave it unset — Gmail requires *some* "To", so this service defaults it to GMAIL_USER
 *   when `to` is omitted and `bcc` is present).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  // Keyed by gmailUser + a hash of the password, so a credential change naturally gets a fresh
  // entry instead of silently reusing a transporter authenticated with the old password.
  private readonly userTransporters = new Map<string, Transporter>();

  constructor(
    private readonly mailerService: MailerService,
    private readonly config: ConfigService,
    private readonly mailCredentials: MailCredentialsService,
  ) {}

  /**
   * A fresh nodemailer transport does its own TCP+TLS+AUTH handshake on every single sendMail()
   * call. Sending a batch of hundreds of emails that way opens hundreds of independent logins in
   * quick succession, which Gmail's abuse detection treats as suspicious and starts rejecting with
   * "454 4.7.0 Too many login attempts" — happened in practice during a large draft-and-send run.
   * Reusing one pooled, authenticated connection per Gmail account (nodemailer's `pool: true`)
   * fixes this: a small number of real connections handle an arbitrary number of messages.
   */
  private async getUserTransporter(userCred: { gmailUser: string; gmailAppPassword: string }): Promise<Transporter> {
    const key = `${userCred.gmailUser}:${createHash('sha256').update(userCred.gmailAppPassword).digest('hex')}`;
    const cached = this.userTransporters.get(key);
    if (cached) return cached;

    const transporter = nodemailer.createTransport({
      ...(await resolveSmtpHost('smtp.gmail.com')),
      port: 465,
      secure: true,
      auth: { user: userCred.gmailUser, pass: userCred.gmailAppPassword },
      // This Gmail account has been flagged repeatedly today (daily-quota rejections cascading
      // into "too many login attempts" lockouts) — a test batch showed even 2-3 simultaneous
      // pooled connections retriggers the lockout, while a single isolated send succeeds every
      // time. Forced down to exactly one connection until the account's flagged state settles.
      pool: true,
      maxConnections: 1,
      maxMessages: Infinity,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    this.userTransporters.set(key, transporter);
    return transporter;
  }

  isConfigured(): boolean {
    return !!(this.config.get<string>('GMAIL_USER') && this.config.get<string>('GMAIL_APP_PASSWORD'));
  }

  /** Same as isConfigured(), but also true when this specific user has saved their own credential. */
  async isConfiguredFor(userId?: string): Promise<boolean> {
    if (this.isConfigured()) return true;
    if (!userId) return false;
    return !!(await this.mailCredentials.getDecrypted(userId));
  }

  async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    const userCred = options.userId ? await this.mailCredentials.getDecrypted(options.userId) : null;
    if (!userCred && !this.isConfigured()) {
      throw new Error(
        'Gmail SMTP is not configured — save a Gmail App Password on the Outreach page, or set ' +
          'GMAIL_USER/GMAIL_APP_PASSWORD in backend/.env.',
      );
    }
    if (!options.to && !options.bcc) {
      throw new Error('sendMail requires at least one of `to` or `bcc`.');
    }

    const fromUser = userCred?.gmailUser ?? this.config.get<string>('GMAIL_USER');
    // Gmail's SMTP endpoint rejects a message with no "To" header at all, so when the caller
    // only supplied `bcc` (the "send to many, hide the list from each other" case), default the
    // visible To to the sending account itself.
    const to = options.to ?? fromUser;

    const mailPayload = {
      to,
      cc: options.cc,
      bcc: options.bcc,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    try {
      // A per-user saved credential uses that user's own pooled transporter — the shared
      // MailerService below only ever uses the .env credentials, so it can't be reused when a
      // user has their own.
      const info = userCred
        ? await (await this.getUserTransporter(userCred)).sendMail({
            from: `"Job Automation Bot" <${userCred.gmailUser}>`,
            ...mailPayload,
          })
        : await this.mailerService.sendMail(mailPayload);

      this.logger.log(`Email sent: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted ?? [],
        rejected: info.rejected ?? [],
      };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Failed to send email: ${message}`);
      throw new Error(`Failed to send email: ${message}`);
    }
  }
}
