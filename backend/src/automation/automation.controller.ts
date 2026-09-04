import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from './automation.service';
import { StartAutomationDto } from './dto/start-automation.dto';

@Controller('automation')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post('start')
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartAutomationDto) {
    return this.automationService.start(user.userId, dto.filterId);
  }

  @Post('stop')
  stop(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.stop(user.userId);
  }

  @Post('pause')
  pause(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.pause(user.userId);
  }

  @Post('resume')
  resume(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.resume(user.userId);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.automationService.status(user.userId);
  }
}
