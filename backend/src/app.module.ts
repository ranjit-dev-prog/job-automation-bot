import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { CredentialsModule } from './credentials/credentials.module';
import { FiltersModule } from './filters/filters.module';
import { ApplicationsModule } from './applications/applications.module';
import { AutomationModule } from './automation/automation.module';
import { MailModule } from './mail/mail.module';
import { ExtensionModule } from './extension/extension.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    ProfileModule,
    CredentialsModule,
    FiltersModule,
    ApplicationsModule,
    AutomationModule,
    MailModule,
    ExtensionModule,
  ],
})
export class AppModule {}
