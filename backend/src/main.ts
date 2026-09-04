import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const frontendUrl = config.get<string>('FRONTEND_URL', 'http://localhost:4200');
  app.enableCors({
    // The Chrome extension's requests come from a chrome-extension:// origin (its id is random
    // for a locally "Load unpacked" install, so it can't be pinned to one exact value) —
    // allowed alongside the Angular dev-server origin, nothing else.
    origin: (origin, callback) => {
      if (!origin || origin === frontendUrl || origin.startsWith('chrome-extension://')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
}

bootstrap();
