import { Progress, ProgressLocation, window } from 'vscode';

export const createWithProcess = (title: string, cleanUp?: (isAborting: boolean) => void) => {
  let finishProgress: (() => void) | undefined;
  let cancelProgress: (() => void) | undefined;
  let updateProgress:
    | Progress<{
        message?: string;
        increment?: number;
      }>
    | undefined;

  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      return new Promise<void>((resolve, reject) => {
        finishProgress = resolve;
        cancelProgress = reject;
        updateProgress = progress;

        token.onCancellationRequested(() => {
          reject(new Error('Cancel operation'));
          cleanUp?.(true);
        });
      });
    }
  );

  return {
    finishProgress,
    cancelProgress,
    updateProgress,
  };
};
