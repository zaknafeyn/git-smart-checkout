import * as assert from 'assert';
import * as vscode from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import {
  OperationCancelledError,
  PrCloneTempWorktreeService,
} from '../../services/prCloneTempWorktreeService';
import { PrCloneData } from '../../services/prCloneService';

function makeCloneData(): PrCloneData {
  return {
    prData: {
      number: 42,
      title: 'Test PR',
      body: '',
      head: {
        ref: 'source',
        sha: 'abc123',
        repo: { full_name: 'owner/repo', clone_url: '' },
      },
      base: { ref: 'main', repo: { full_name: 'owner/repo' } },
      html_url: 'https://github.com/owner/repo/pull/42',
      labels: [],
      assignees: [],
    },
    targetBranch: 'main',
    featureBranch: 'feature',
    description: '',
    selectedCommits: ['abc123'],
    isDraft: false,
  };
}

describe('PrCloneTempWorktreeService cancellation', () => {
  it('uses a typed cancellation sentinel', () => {
    const error = new OperationCancelledError();

    assert.ok(error instanceof Error);
    assert.strictEqual(error.name, 'OperationCancelledError');
    assert.strictEqual(error.message, 'PR clone cancelled');
  });

  it('reports cancellation as information and preserves branch and worktree cleanup', async () => {
    const tempPath = '/tmp/git-smart-checkout-pr-clone-test';
    const deletedBranches: string[] = [];
    const removedWorktrees: string[] = [];
    const infoMessages: string[] = [];
    const errorMessages: string[] = [];
    const logErrors: string[] = [];
    const logInfo: string[] = [];
    const cleanupActions: string[] = [];
    let cancelled = false;

    const git = {
      worktreeRemove: async (worktreePath: string) => {
        removedWorktrees.push(worktreePath);
      },
      worktreeList: async () => [],
    } as unknown as GitExecutor;
    const loggingService = {
      error: (message: string) => logErrors.push(message),
      warn: () => {},
      info: (message: string) => logInfo.push(message),
      debug: () => {},
    } as unknown as LoggingService;
    const service = new PrCloneTempWorktreeService(
      git,
      {} as GitHubClient,
      loggingService
    );

    (service as any).createTempWorktree = async () => {
      (service as any).tempWorkspacePath = tempPath;
      (service as any).tempGit = {
        deleteLocalBranch: async (branchName: string) => {
          deletedBranches.push(branchName);
        },
      };
      return tempPath;
    };
    (service as any).fetchAllBranches = async () => {};
    (service as any).createUniqueFeatureBranch = async () => {
      cancelled = true;
      return 'feature';
    };
    service.addCleanUpActions({
      cleanUpActionBegin: () => cleanupActions.push('begin'),
      cleanUpActionEnd: () => cleanupActions.push('end'),
    });

    const originalWithProgress = vscode.window.withProgress.bind(vscode.window);
    const originalShowInformationMessage =
      vscode.window.showInformationMessage.bind(vscode.window);
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);

    (vscode.window as any).withProgress = async (
      _options: vscode.ProgressOptions,
      task: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
      ) => Promise<void>
    ) => task(
      { report: () => {} },
      {
        get isCancellationRequested() {
          return cancelled;
        },
        onCancellationRequested: () => ({ dispose: () => {} }),
      } as vscode.CancellationToken
    );
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessages.push(message);
      return undefined;
    };
    (vscode.window as any).showErrorMessage = async (message: string) => {
      errorMessages.push(message);
      return undefined;
    };

    try {
      await service.clonePR(makeCloneData());

      assert.deepStrictEqual(infoMessages, ['PR clone cancelled']);
      assert.deepStrictEqual(errorMessages, []);
      assert.deepStrictEqual(logErrors, []);
      assert.ok(logInfo.includes('PR clone cancelled by user'));
      assert.deepStrictEqual(deletedBranches, ['feature']);
      assert.deepStrictEqual(removedWorktrees, [tempPath]);
      assert.deepStrictEqual(cleanupActions, ['begin', 'end']);
    } finally {
      (vscode.window as any).withProgress = originalWithProgress;
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      (service as any).tempWorkspacePath = undefined;
      service.dispose();
    }
  });
});
