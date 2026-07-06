import { Module, DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggingMiddleware } from './logging.middleware';
import { LoggingService, LoggingOptions } from './logging.service';
import { NugiLoggerService } from './logger.service';

@Module({})
export class LoggingModule implements NestModule {
  constructor(
    private readonly loggingService: LoggingService,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggingMiddleware)
      .forRoutes('*');
  }

  static forRoot(options: LoggingOptions): DynamicModule {
    const loggingService = new LoggingService(options);
    return {
      module: LoggingModule,
      providers: [
        {
          provide: LoggingService,
          useValue: loggingService,
        },
        {
          provide: NugiLoggerService,
          useValue: new NugiLoggerService(loggingService),
        },
        LoggingMiddleware,
      ],
      exports: [LoggingService, NugiLoggerService],
    };
  }
} 