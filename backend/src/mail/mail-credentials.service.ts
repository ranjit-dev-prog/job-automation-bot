import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { SaveMailCredentialDto } from './dto/save-mail-credential.dto';

/**
 * Per-user Gmail App Password storage, saved from the Outreach page instead of editing
 * backend/.env. Same encrypted-at-rest pattern as CredentialsService (job-platform logins) —
 * the app password is never returned to the client after saving, only whether one is connected.
 */
@Injectable()
export class MailCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async status(userId: string): Promise<{ connected: boolean; gmailUser: string | null }> {
    const row = await this.prisma.mailCredential.findUnique({ where: { userId } });
    return { connected: !!row, gmailUser: row?.gmailUser ?? null };
  }

  async save(userId: string, dto: SaveMailCredentialDto) {
    // Google displays App Passwords with spaces for readability — strip them before storing.
    const gmailAppPasswordEnc = this.crypto.encrypt(dto.gmailAppPassword.replace(/\s+/g, ''));
    await this.prisma.mailCredential.upsert({
      where: { userId },
      update: { gmailUser: dto.gmailUser, gmailAppPasswordEnc },
      create: { userId, gmailUser: dto.gmailUser, gmailAppPasswordEnc },
    });
    return { connected: true, gmailUser: dto.gmailUser };
  }

  async remove(userId: string) {
    const existing = await this.prisma.mailCredential.findUnique({ where: { userId } });
    if (!existing) throw new NotFoundException('No saved Gmail credential');
    await this.prisma.mailCredential.delete({ where: { userId } });
    return { success: true };
  }

  /** Used internally by MailService — decrypts on demand, never exposed via an endpoint. */
  async getDecrypted(userId: string): Promise<{ gmailUser: string; gmailAppPassword: string } | null> {
    const row = await this.prisma.mailCredential.findUnique({ where: { userId } });
    if (!row) return null;
    return { gmailUser: row.gmailUser, gmailAppPassword: this.crypto.decrypt(row.gmailAppPasswordEnc) };
  }
}
