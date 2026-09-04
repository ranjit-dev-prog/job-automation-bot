import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import {
  ApplyContext,
  JobListing,
  JobPlatformCredentials,
  JobPlatformProvider,
  JobSearchFilter,
} from '../interfaces/job-platform-provider.interface';

/**
 * Login/search verified live against naukri.com; applyToJob is still a stub — Naukri doesn't
 * have a LinkedIn-style single-click "Easy Apply" for most postings (many redirect to the
 * company's own site, or open a "Chat" application flow), so that needs its own live-verified
 * implementation before it's safe to enable.
 */
@Injectable()
export class NaukriProvider implements JobPlatformProvider {
  readonly platform = 'NAUKRI';
  private readonly logger = new Logger(NaukriProvider.name);

  async login(page: Page, credentials: JobPlatformCredentials): Promise<void> {
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });

    // Naukri, like LinkedIn, duplicates this form's markup (one hidden copy per breakpoint) —
    // an id selector alone can silently match the hidden one and leave the visible form empty.
    const usernameField = page.locator('#usernameField:visible').first();
    const passwordField = page.locator('#passwordField:visible').first();
    // Naukri renders two submit buttons on this form ("Login" and "Use OTP to Login") — match
    // the exact label so this doesn't accidentally trigger the OTP flow.
    const loginButton = page.locator('button:visible[type="submit"]').filter({ hasText: /^Login$/ }).first();

    const foundLoginForm = await usernameField
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!foundLoginForm) {
      throw new Error(
        `Naukri did not show the expected login form (page title: "${await page.title()}", url: ${page.url()}). ` +
          'Naukri may have changed its markup — try PLAYWRIGHT_HEADLESS=false to see what actually loaded.',
      );
    }

    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);
    await loginButton.click();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const stillOnLogin = page.url().includes('/nlogin/login');
    if (stillOnLogin) {
      throw new Error(
        'Naukri login did not complete — likely a wrong password, or a CAPTCHA/verification ' +
          'checkpoint that requires manual intervention.',
      );
    }
  }

  async searchJobs(_page: Page, _filter: JobSearchFilter): Promise<JobListing[]> {
    throw new Error('NaukriProvider.searchJobs is a skeleton — fill in real selectors before use.');
  }

  async applyToJob(_page: Page, _job: JobListing, _context: ApplyContext): Promise<void> {
    throw new Error('NaukriProvider.applyToJob is a skeleton — fill in real selectors before use.');
  }
}
