import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CredentialsService } from './credentials.service';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';

@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.credentialsService.list(user.userId);
  }

  @Post()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertCredentialDto) {
    return this.credentialsService.upsert(user.userId, dto);
  }

  @Delete(':platform')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('platform') platform: string) {
    return this.credentialsService.remove(user.userId, platform);
  }
}
