import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';
import { MailCredentialsService } from './mail-credentials.service';
import { MailController } from './mail.controller';
import { resolveSmtpHost } from './smtp-host-resolver.util';

/**
 * Gmail SMTP sender, reusable anywhere in the app (outreach emails, notifications, password
 * resets, etc.) — not tied to any one feature. Registers the transport once here; every
 * consumer just injects MailService and calls sendMail().
 *
 * Requires GMAIL_USER (the Gmail address) and GMAIL_APP_PASSWORD (a 16-character App Password
 * from myaccount.google.com/apppasswords — NOT the account's real login password; that won't
 * work over SMTP once 2-Step Verification is on, which App Passwords require in the first place).
 */
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const user = config.get<string>('GMAIL_USER');
        const pass = config.get<string>('GMAIL_APP_PASSWORD');
        return {
          transport: {
            ...(await resolveSmtpHost('smtp.gmail.com')),
            port: 465,
            secure: true, // 465 is the implicit-TLS port — must be true, not STARTTLS-on-587
            auth: user && pass ? { user, pass } : undefined,
            connectionTimeout: 15_000,
            greetingTimeout: 15_000,
            socketTimeout: 20_000,
          },
          defaults: {
            from: user ? `"Job Automation Bot" <${user}>` : undefined,
          },
        };
      },
    }),
  ],
  controllers: [MailController],
  providers: [MailService, MailCredentialsService],
  exports: [MailService, MailCredentialsService],
})
export class MailModule {}
