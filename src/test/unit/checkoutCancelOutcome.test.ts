import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_AND_POP_IN_NEW_BRANCH } from '../../commands/checkoutToCommand/constants';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const nextBranch: IGitRef = {
  name: 'feature-x',
  fullName: 'feature-x',
  remote: false,
  isTag: false,
} as unknown as IGitRef;

function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    isWorkdirHasChanges: async () => true,
    getStashConflictPreview: async () => ['file.ts'],
    createStash: async () => {},
    checkout: async () => {},
    hasUpstreamBranch: async () => false,
    isStashWithMessageExists: async () => false,
    popStash: async () => {},
    ...overrides,
  } as unknown as GitExecutor;
}

describe('AutoStashService checkout cancellation outcome', () => {
  it('reports "cancelled" and never checks out when the user rejects the conflict warning', async () => {
    const checkoutCalls: string[] = [];
    const git = makeGitStub({
      checkout: (async (branch: string) => {
        checkoutCalls.push(branch);
      }) as unknown as GitExecutor['checkout'],
    });

    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    (vscode.window as any).showWarningMessage = async () => undefined;

    try {
      const service = new AutoStashService({} as ConfigurationManager, mockLogService);
      const outcome = await service.checkoutAndStashChanges(
        git,
        'main',
        nextBranch,
        AUTO_STASH_AND_POP_IN_NEW_BRANCH
      );

      assert.strictEqual(outcome, 'cancelled');
      assert.deepStrictEqual(checkoutCalls, []);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('reports "completed" and checks out when the user confirms the conflict warning', async () => {
    const checkoutCalls: string[] = [];
    const git = makeGitStub({
      checkout: (async (branch: string) => {
        checkoutCalls.push(branch);
      }) as unknown as GitExecutor['checkout'],
    });

    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    (vscode.window as any).showWarningMessage = async () => 'Continue';

    try {
      const service = new AutoStashService({} as ConfigurationManager, mockLogService);
      const outcome = await service.checkoutAndStashChanges(
        git,
        'main',
        nextBranch,
        AUTO_STASH_AND_POP_IN_NEW_BRANCH
      );

      assert.strictEqual(outcome, 'completed');
      assert.deepStrictEqual(checkoutCalls, ['feature-x']);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('reports "completed" when there is nothing to stash (no conflict preview requested)', async () => {
    const git = makeGitStub({ isWorkdirHasChanges: async () => false });
    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    const outcome = await service.checkoutAndStashChanges(
      git,
      'main',
      nextBranch,
      AUTO_STASH_AND_POP_IN_NEW_BRANCH
    );

    assert.strictEqual(outcome, 'completed');
  });
});
