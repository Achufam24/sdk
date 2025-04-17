import { Module, DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggingMiddleware } from './logging.middleware';
import { LoggingService, LoggingOptions } from './logging.service';

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
    return {
      module: LoggingModule,
      providers: [
        {
          provide: LoggingService,
          useValue: new LoggingService(options),
        },
        LoggingMiddleware,
      ],
      exports: [LoggingService],
    };
  }
} 