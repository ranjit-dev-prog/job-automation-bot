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
 * Skeleton provider — see NaukriProvider for the pattern. Hirist's login/search/apply flow
 * needs to be inspected live and the selectors below filled in before this works for real.
 */
@Injectable()
export class HiristProvider implements JobPlatformProvider {
  readonly platform = 'HIRIST';

  async login(page: Page, _credentials: JobPlatformCredentials): Promise<void> {
    await page.goto('https://www.hirist.com/login', { waitUntil: 'domcontentloaded' });
    // TODO: fill in Hirist's real field selectors and submit flow.
    throw new Error('HiristProvider.login is a skeleton — fill in real selectors before use.');
  }

  async searchJobs(_page: Page, _filter: JobSearchFilter): Promise<JobListing[]> {
    throw new Error('HiristProvider.searchJobs is a skeleton — fill in real selectors before use.');
  }

  async applyToJob(_page: Page, _job: JobListing, _context: ApplyContext): Promise<void> {
    throw new Error('HiristProvider.applyToJob is a skeleton — fill in real selectors before use.');
  }
}
