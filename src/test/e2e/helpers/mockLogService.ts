import { LoggingService } from '../../../logging/loggingService';

export const mockLogService = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  show: () => {},
  dispose: () => {},
} as unknown as LoggingService;
