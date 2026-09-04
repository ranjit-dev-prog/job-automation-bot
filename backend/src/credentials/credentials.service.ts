import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // Never returns decrypted secrets to the client — only which platforms are connected.
  async list(userId: string) {
    const rows = await this.prisma.platformCredential.findMany({
      where: { userId },
      select: { id: true, platform: true, createdAt: true, updatedAt: true },
    });
    return rows;
  }

  async upsert(userId: string, dto: UpsertCredentialDto) {
    const usernameEnc = this.crypto.encrypt(dto.username);
    const passwordEnc = this.crypto.encrypt(dto.password);

    const saved = await this.prisma.platformCredential.upsert({
      where: { userId_platform: { userId, platform: dto.platform } },
      update: { usernameEnc, passwordEnc },
      create: { userId, platform: dto.platform, usernameEnc, passwordEnc },
    });
    return { id: saved.id, platform: saved.platform, updatedAt: saved.updatedAt };
  }

  async remove(userId: string, platform: string) {
    const existing = await this.prisma.platformCredential.findUnique({
      where: { userId_platform: { userId, platform } },
    });
    if (!existing) {
      throw new NotFoundException('No saved credential for this platform');
    }
    await this.prisma.platformCredential.delete({ where: { id: existing.id } });
    return { success: true };
  }

  // Used internally by the automation engine — decrypts on demand, never exposed via an endpoint.
  async getDecryptedForAutomation(userId: string, platform: string) {
    const row = await this.prisma.platformCredential.findUnique({
      where: { userId_platform: { userId, platform } },
    });
    if (!row) {
      throw new NotFoundException(`No saved credential for ${platform}`);
    }
    return {
      username: this.crypto.decrypt(row.usernameEnc),
      password: this.crypto.decrypt(row.passwordEnc),
    };
  }
}
