import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { FiltersService } from './filters.service';
import { UpsertFilterDto } from './dto/upsert-filter.dto';

@Controller('filters')
@UseGuards(JwtAuthGuard)
export class FiltersController {
  constructor(private readonly filtersService: FiltersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.filtersService.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertFilterDto) {
    return this.filtersService.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertFilterDto,
  ) {
    return this.filtersService.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.filtersService.remove(user.userId, id);
  }
}
