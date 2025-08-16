import { useCallback } from 'react';
import { useLogger } from './useLogger';
import { WebviewCommand } from '@/types/commands';

export const useSendMessage = () => {
  const logger = useLogger(false);

  const sendMessage = useCallback(
    (command: WebviewCommand, data?: any) => {
      if (typeof window !== 'undefined' && (window as any).vscode) {
        logger.debug(`Sending command: ${command}`);
        (window as any).vscode.postMessage({
          command,
          ...data,
        });
      }
    },
    [logger]
  );

  return sendMessage;
};
