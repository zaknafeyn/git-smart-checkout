import { useCallback } from 'react';
import { WebviewCommand } from '@/types/commands';

export const useSendMessage = () => {
  const sendMessage = useCallback((command: WebviewCommand, data?: any) => {
    if (typeof window !== 'undefined' && (window as any).vscode) {
      console.debug(`[Webview]: Sending command: ${command}`);

      (window as any).vscode.postMessage({
        command,
        ...data,
      });
    }
  }, []);

  return sendMessage;
};
