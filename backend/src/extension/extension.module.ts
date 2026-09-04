import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProfileModule } from '../profile/profile.module';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';

@Module({
  imports: [AiModule, ProfileModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
