import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { initializeErrorReporting } from 'nugi-logs-sdk';

async function bootstrap() {
  initializeErrorReporting({
    apiKey: process.env.ERROR_REPORTING_API_KEY,
    appId: process.env.APP_ID,
    environment: process.env.NODE_ENV,
    apiUrl: process.env.ERROR_REPORTING_URL
  });

  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap(); 