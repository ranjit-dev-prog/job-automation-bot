import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import {
  ApplyContext,
  JobListing,
  JobPlatformCredentials,
  JobPlatformProvider,
  JobSearchFilter,
} from '../interfaces/job-platform-provider.interface';

/**
 * Skeleton provider — see NaukriProvider for the pattern. Indeed's login/search/apply flow
 * needs to be inspected live and the selectors below filled in before this works for real.
 */
@Injectable()
export class IndeedProvider implements JobPlatformProvider {
  readonly platform = 'INDEED';

  async login(page: Page, _credentials: JobPlatformCredentials): Promise<void> {
    await page.goto('https://secure.indeed.com/account/login', { waitUntil: 'domcontentloaded' });
    // TODO: fill in Indeed's real field selectors and submit flow.
    throw new Error('IndeedProvider.login is a skeleton — fill in real selectors before use.');
  }

  async searchJobs(_page: Page, _filter: JobSearchFilter): Promise<JobListing[]> {
    throw new Error('IndeedProvider.searchJobs is a skeleton — fill in real selectors before use.');
  }

  async applyToJob(_page: Page, _job: JobListing, _context: ApplyContext): Promise<void> {
    throw new Error('IndeedProvider.applyToJob is a skeleton — fill in real selectors before use.');
  }
}
