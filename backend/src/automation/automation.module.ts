import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { AiModule } from '../ai/ai.module';
import { ProfileModule } from '../profile/profile.module';
import { OutreachModule } from '../outreach/outreach.module';
import { AutomationController } from './automation.controller';
import { OutreachController } from './outreach.controller';
import { AutomationService } from './automation.service';
import { ProviderRegistryService } from './provider-registry.service';
import { LinkedInProvider } from './providers/linkedin.provider';
import { NaukriProvider } from './providers/naukri.provider';
import { IndeedProvider } from './providers/indeed.provider';
import { HiristProvider } from './providers/hirist.provider';

@Module({
  imports: [CredentialsModule, AiModule, ProfileModule, OutreachModule],
  controllers: [AutomationController, OutreachController],
  providers: [
    AutomationService,
    ProviderRegistryService,
    LinkedInProvider,
    NaukriProvider,
    IndeedProvider,
    HiristProvider,
  ],
})
export class AutomationModule {}
