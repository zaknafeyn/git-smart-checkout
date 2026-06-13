import { CancellationToken, Progress, ProgressLocation, ProgressOptions, window } from 'vscode';

export interface ProgressUpdate {
  message?: string;
  increment?: number;
}

export type WithProgress = (
  options: ProgressOptions,
  task: (progress: Progress<ProgressUpdate>, token: CancellationToken) => Thenable<void>
) => Thenable<void>;

export const createWithProcess = (
  title: string,
  cleanUp?: (isAborting: boolean) => void | Promise<void>,
  withProgress: WithProgress = (options, task) => window.withProgress(options, task)
) => {
  let resolveProgress: (() => void) | undefined;
  let progressRef: Progress<ProgressUpdate> | undefined;
  let isSettled = false;
  let cancellationHandled = false;
  const pendingReports: ProgressUpdate[] = [];

  const settleProgress = () => {
    if (isSettled) {
      return;
    }

    isSettled = true;
    pendingReports.length = 0;
    resolveProgress?.();
  };

  const updateProgress: Progress<ProgressUpdate> = {
    report: (update) => {
      if (isSettled) {
        return;
      }

      if (progressRef) {
        progressRef.report(update);
      } else {
        pendingReports.push(update);
      }
    },
  };

  const progressPromise = withProgress(
    {
      location: ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (progress, token) =>
      new Promise<void>((resolve) => {
        resolveProgress = resolve;
        progressRef = progress;

        pendingReports.splice(0).forEach((update) => progress.report(update));
        token.onCancellationRequested(() => {
          settleProgress();

          if (cancellationHandled) {
            return;
          }

          cancellationHandled = true;
          void Promise.resolve()
            .then(() => cleanUp?.(true))
            .catch(() => undefined);
        });

        if (isSettled) {
          resolve();
        }
      })
  );

  // VS Code owns this promise. Guard it so cancellation or host behavior cannot
  // surface as an unhandled rejection in the extension host.
  void Promise.resolve(progressPromise).catch(() => undefined);

  return {
    finishProgress: settleProgress,
    cancelProgress: settleProgress,
    updateProgress,
  };
};
