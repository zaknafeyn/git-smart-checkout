import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { PrCloneReportedError } from '../../services/prCloneError';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { PrCloneData, PrCloneService } from '../../services/prCloneService';
import { GitHubPR } from '../../types/dataTypes';
import { WebviewCommand } from '../../types/webviewCommands';
import { PrCloneWebViewProvider } from '../../view/PrCloneWebViewProvider';
import { mockLogService } from '../e2e/helpers/mockLogService';

const prData = {
  number: 42,
  title: 'Test PR',
  head: { ref: 'feature/source' },
} as GitHubPR;

const cloneData: PrCloneData = {
  prData,
  targetBranch: 'main',
  featureBranch: 'feature/clone',
  description: 'Clone description',
  selectedCommits: [],
  isDraft: false,
};

class TestPrCloneInPlaceService extends PrCloneInPlaceService {
  readonly reportedErrors: unknown[] = [];

  protected override async showCloneError(error: unknown): Promise<void> {
    this.reportedErrors.push(error);
  }
}

describe('PrCloneInPlaceService error recovery', () => {
  it('restores the original branch without resetting or deleting when setup fails', async () => {
    const events: string[] = [];
    const setupError = new Error('target checkout failed');
    let targetCheckoutAttempted = false;

    const git = {
      getCurrentBranch: async () => {
        events.push('get-current-branch');
        return 'original';
      },
      isWorkdirHasChanges: async () => false,
      fetchSpecificBranch: async () => {},
      checkout: async (branch: string) => {
        events.push(`checkout:${branch}`);
        if (branch === 'main' && !targetCheckoutAttempted) {
          targetCheckoutAttempted = true;
          throw setupError;
        }
      },
      isCherryPickInProgress: async () => false,
      reset: async () => {
        events.push('reset');
      },
      deleteLocalBranch: async (branch: string) => {
        events.push(`delete:${branch}`);
      },
    } as unknown as GitExecutor;

    const service = new TestPrCloneInPlaceService(
      git,
      {} as GitHubClient,
      mockLogService
    );
    let cleanupCompleted = false;
    service.addCleanUpActions({
      cleanUpActionEnd: () => {
        cleanupCompleted = true;
      },
    });

    await assert.rejects(
      service.clonePR(cloneData),
      (error: unknown) =>
        error instanceof PrCloneReportedError && error.originalError === setupError
    );

    assert.strictEqual(cleanupCompleted, true);
    assert.deepStrictEqual(service.reportedErrors, [setupError]);
    assert.ok(events.includes('checkout:original'));
    assert.ok(!events.includes('reset'));
    assert.ok(!events.some((event) => event.startsWith('delete:')));
  });

  it('restores stash, removes the clone branch, and clears state after a push failure', async () => {
    const events: string[] = [];
    const pushError = new Error('push failed');
    let run = 0;

    const git = {
      getCurrentBranch: async () => {
        run++;
        events.push(`get-current-branch:${run}`);
        if (run === 2) {
          throw new Error('second run failed before state capture');
        }
        return 'original';
      },
      isWorkdirHasChanges: async () => true,
      createStash: async (message: string) => {
        events.push(`stash:${message}`);
      },
      fetchSpecificBranch: async () => {},
      checkout: async (branch: string) => {
        events.push(`checkout:${branch}`);
      },
      pullCurrentBranch: async () => {},
      createUniqueFeatureBranch: async () => 'feature/clone',
      hasConflicts: async () => false,
      getCommitTimestamp: async (sha: string) => ({ sha, timestamp: 1 }),
      cherryPick: async () => ({ conflicts: false }),
      pushBranchToGitHub: async () => {
        events.push('push');
        throw pushError;
      },
      isCherryPickInProgress: async () => false,
      reset: async () => {
        events.push('reset');
      },
      popStash: async (message: string) => {
        events.push(`pop:${message}`);
      },
      deleteLocalBranch: async (branch: string) => {
        events.push(`delete:${branch}`);
      },
    } as unknown as GitExecutor;

    const service = new TestPrCloneInPlaceService(
      git,
      {} as GitHubClient,
      mockLogService
    );

    await assert.rejects(
      service.clonePR({ ...cloneData, selectedCommits: ['abc123'] }),
      (error: unknown) =>
        error instanceof PrCloneReportedError && error.originalError === pushError
    );

    assert.ok(events.includes('reset'));
    assert.ok(events.includes('checkout:original'));
    assert.ok(events.some((event) => event.startsWith('pop:')));
    assert.ok(events.includes('delete:feature/clone'));

    await assert.rejects(
      service.clonePR(cloneData),
      (error: unknown) => error instanceof PrCloneReportedError
    );

    assert.strictEqual(
      events.filter((event) => event.startsWith('pop:')).length,
      1,
      'the old stash must not be reused'
    );
    assert.strictEqual(
      events.filter((event) => event.startsWith('delete:')).length,
      1,
      'the old clone branch must not be reused'
    );
    assert.strictEqual(service.reportedErrors.length, 2);
  });
});

describe('PrCloneWebViewProvider clone state recovery', () => {
  it('posts a non-cloning state when the clone service rejects', async () => {
    const messages: Array<{ command: WebviewCommand; isCloning?: boolean }> = [];
    const cloneError = new PrCloneReportedError(new Error('push failed'));
    const fakeCloneService = {
      onDidChangeRepository: () => ({ dispose: () => {} }),
      clonePR: async () => {
        throw cloneError;
      },
    } as unknown as PrCloneService;

    const provider = new PrCloneWebViewProvider(
      {} as any,
      mockLogService as LoggingService,
      {} as any,
      fakeCloneService
    );

    (provider as any).currentPrData = prData;
    (provider as any).webviewView = {
      webview: {
        postMessage: async (message: { command: WebviewCommand; isCloning?: boolean }) => {
          messages.push(message);
          return true;
        },
      },
    };

    await (provider as any).handleClonePR({
      targetBranch: 'main',
      featureBranch: 'feature/clone',
      description: '',
      selectedCommits: [],
      isDraft: false,
    });

    assert.deepStrictEqual(
      messages
        .filter((message) => message.command === WebviewCommand.UPDATE_CLONING_STATE)
        .map((message) => message.isCloning),
      [true, false]
    );
  });
});
