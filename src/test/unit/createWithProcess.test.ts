import * as assert from 'assert';
import { CancellationToken, Progress } from 'vscode';

import {
  createWithProcess,
  ProgressUpdate,
  WithProgress,
} from '../../utils/createWithProcess';

interface ProgressHarness {
  cancel: () => void;
  completion: Promise<void>;
  reports: ProgressUpdate[];
  start: () => void;
  withProgress: WithProgress;
}

function createProgressHarness(): ProgressHarness {
  let cancellationListener: (() => void) | undefined;
  let progressTask:
    | ((progress: Progress<ProgressUpdate>, token: CancellationToken) => Thenable<void>)
    | undefined;
  let resolveCompletion: (() => void) | undefined;
  let rejectCompletion: ((reason?: unknown) => void) | undefined;

  const reports: ProgressUpdate[] = [];
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const progress: Progress<ProgressUpdate> = {
    report: (update) => reports.push(update),
  };
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      cancellationListener = listener;
      return { dispose: () => undefined };
    },
  } as CancellationToken;

  return {
    cancel: () => cancellationListener?.(),
    completion,
    reports,
    start: () => {
      assert.ok(progressTask, 'withProgress task was not registered');
      void Promise.resolve(progressTask(progress, token)).then(
        () => resolveCompletion?.(),
        (error) => rejectCompletion?.(error)
      );
    },
    withProgress: (_options, task) => {
      progressTask = task;
      return completion;
    },
  };
}

function waitForAsyncHandlers(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('createWithProcess', () => {
  it('returns usable handles and queues reports before the progress task starts', async () => {
    const harness = createProgressHarness();
    const handles = createWithProcess('Test progress', undefined, harness.withProgress);

    handles.updateProgress.report({ message: 'Queued update' });
    assert.deepStrictEqual(harness.reports, []);

    harness.start();
    assert.deepStrictEqual(harness.reports, [{ message: 'Queued update' }]);

    handles.finishProgress();
    await harness.completion;
  });

  it('remembers finish requests made before the progress task starts', async () => {
    const harness = createProgressHarness();
    const handles = createWithProcess('Test progress', undefined, harness.withProgress);

    handles.finishProgress();
    harness.start();

    await harness.completion;
  });

  it('remembers cancel requests made before the progress task starts', async () => {
    const harness = createProgressHarness();
    const handles = createWithProcess('Test progress', undefined, harness.withProgress);

    handles.cancelProgress();
    harness.start();

    await harness.completion;
  });

  it('resolves cancellation and contains rejected asynchronous cleanup', async () => {
    const harness = createProgressHarness();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      let cleanUpCalled = false;
      createWithProcess(
        'Test progress',
        async () => {
          cleanUpCalled = true;
          throw new Error('cleanup failed');
        },
        harness.withProgress
      );

      harness.start();
      harness.cancel();
      await harness.completion;
      await waitForAsyncHandlers();

      assert.strictEqual(cleanUpCalled, true);
      assert.deepStrictEqual(unhandledRejections, []);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });
});
