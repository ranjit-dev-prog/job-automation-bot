import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ExtensionService } from './extension.service';
import { ScoreRelevanceDto } from './dto/score-relevance.dto';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { ReportApplicationDto } from './dto/report-application.dto';

/**
 * API surface for the Chrome extension (see /extension folder at the repo root) — the same JWT
 * auth as every other route, called from the extension's background service worker with
 * `Authorization: Bearer <token>` after the user signs in through the popup.
 */
@Controller('extension')
@UseGuards(JwtAuthGuard)
export class ExtensionController {
  constructor(private readonly extensionService: ExtensionService) {}

  @Get('context')
  getContext(@CurrentUser() user: AuthenticatedUser) {
    return this.extensionService.getContext(user.userId);
  }

  @Post('score')
  score(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScoreRelevanceDto) {
    return this.extensionService.scoreRelevance(user.userId, dto.jobTitle, dto.jobDescription);
  }

  @Post('answer')
  answer(@CurrentUser() user: AuthenticatedUser, @Body() dto: AnswerQuestionDto) {
    return this.extensionService.answerQuestion(user.userId, dto.question);
  }

  @Post('applications')
  reportApplication(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportApplicationDto) {
    return this.extensionService.reportApplication(user.userId, dto);
  }
}
