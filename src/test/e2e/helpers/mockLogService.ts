import { LoggingService } from '../../../logging/loggingService';

export const mockLogService = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  dispose: () => {},
} as unknown as LoggingService;
