import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertFilterDto } from './dto/upsert-filter.dto';

@Injectable()
export class FiltersService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.jobFilter.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async findOwned(userId: string, id: string) {
    const filter = await this.prisma.jobFilter.findUnique({ where: { id } });
    if (!filter) throw new NotFoundException('Filter not found');
    if (filter.userId !== userId) throw new ForbiddenException();
    return filter;
  }

  create(userId: string, dto: UpsertFilterDto) {
    return this.prisma.jobFilter.create({
      data: { ...dto, platforms: dto.platforms.join(','), userId },
    });
  }

  async update(userId: string, id: string, dto: UpsertFilterDto) {
    await this.findOwned(userId, id);
    return this.prisma.jobFilter.update({
      where: { id },
      data: { ...dto, platforms: dto.platforms.join(',') },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.jobFilter.delete({ where: { id } });
    return { success: true };
  }
}
