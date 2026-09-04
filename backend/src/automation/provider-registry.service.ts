import { Injectable, NotFoundException } from '@nestjs/common';
import { JobPlatformProvider } from './interfaces/job-platform-provider.interface';
import { LinkedInProvider } from './providers/linkedin.provider';
import { NaukriProvider } from './providers/naukri.provider';
import { IndeedProvider } from './providers/indeed.provider';
import { HiristProvider } from './providers/hirist.provider';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Map<string, JobPlatformProvider>;

  constructor(
    linkedIn: LinkedInProvider,
    naukri: NaukriProvider,
    indeed: IndeedProvider,
    hirist: HiristProvider,
  ) {
    this.providers = new Map(
      [linkedIn, naukri, indeed, hirist].map((provider) => [provider.platform, provider]),
    );
  }

  get(platform: string): JobPlatformProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new NotFoundException(`No automation provider registered for platform "${platform}"`);
    }
    return provider;
  }
}
