import { useCallback } from 'react';

import { WebviewCommand } from '@/types/commands';

export interface VsCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): State;
}

export function getVsCodeApi<State = unknown>(): VsCodeApi<State> {
  if (typeof window === 'undefined' || !(window as any).vscode) {
    throw new Error('VS Code webview API is not available.');
  }
  return (window as any).vscode as VsCodeApi<State>;
}

export const useSendMessage = () => {
  const sendMessage = useCallback((command: WebviewCommand, data?: any) => {
    console.debug(`[Webview]: Sending command: ${command}`);

    getVsCodeApi().postMessage({
      command,
      ...data,
    });
  }, []);

  return sendMessage;
};
