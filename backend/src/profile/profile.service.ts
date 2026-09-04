import { Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ResumeParserService } from './resume-parser.service';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeParser: ResumeParserService,
  ) {}

  async getOrCreate(userId: string) {
    let profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await this.prisma.profile.create({ data: { userId } });
    }
    return profile;
  }

  async update(userId: string, dto: UpdateProfileDto) {
    await this.getOrCreate(userId);
    return this.prisma.profile.update({ where: { userId }, data: dto });
  }

  async saveResume(userId: string, file: Express.Multer.File) {
    const profile = await this.getOrCreate(userId);

    // Remove the previously uploaded resume file, if any, before saving the new one.
    if (profile.resumePath) {
      await unlink(profile.resumePath).catch(() => undefined);
    }

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: { resumeFilename: file.originalname, resumePath: file.path },
    });

    const text = await this.resumeParser.extractText(file.path);
    const suggestions = text ? this.resumeParser.parse(text) : null;

    return { profile: updated, suggestions };
  }

  async getResumePath(userId: string): Promise<string> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.resumePath) {
      throw new NotFoundException('No resume uploaded yet');
    }
    return profile.resumePath;
  }
}
