import { LoggingService } from '../logging/loggingService';

export const handleErrorMessage = (
  error: unknown,
  checkMessage = 'No local changes to save',
  message = 'No local changes to stash.',
  defaultMessage = 'Failed to stash the current changes.',
  logService?: Pick<LoggingService, 'error'>
) => {
  if (error instanceof Error) {
    if (error.message === checkMessage) {
      throw new Error(message);
    }

    logService?.error(defaultMessage, { originalError: error.message });
    throw new Error(`${defaultMessage} (${error.message})`);
  }

  logService?.error(defaultMessage, { originalError: String(error) });
  throw new Error(defaultMessage);
};
