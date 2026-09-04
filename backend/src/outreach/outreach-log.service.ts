import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutreachLogService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, channel?: string) {
    return this.prisma.outreachLog.findMany({
      where: { userId, ...(channel ? { channel } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
