import { useCallback, useMemo } from 'react';

import { WebviewCommand } from '@/types/commands';
import { useSendMessage } from './useSendMessage';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type TUseLoggerResponse = {
  log: (message: string, level?: LogLevel) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
};

export const useLogger = (logToConsole = true): TUseLoggerResponse => {
  const sendMessage = useSendMessage();

  const log = useCallback((message: string, level: LogLevel = 'info') => {
    // Send log message to VS Code extension
    sendMessage(WebviewCommand.LOG, {
      level,
      message,
    });

    if (!logToConsole) {
      return;
    }

    const logMessage = `[Webview]: ${message}`;

    // Also log to browser console for development
    switch (level) {
      case 'error':
        console.error(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'debug':
        console.debug(logMessage);
        break;
      case 'info':
      default:
        console.info(logMessage);
        break;
    }
  }, []);

  const info = useCallback((message: string) => log(message, 'info'), [log]);
  const warn = useCallback((message: string) => log(message, 'warn'), [log]);
  const error = useCallback((message: string) => log(message, 'error'), [log]);
  const debug = useCallback((message: string) => log(message, 'debug'), [log]);

  const logger = useMemo(
    () => ({ log, info, warn, error, debug }),
    [log, info, warn, error, debug]
  );
  return logger;
};
