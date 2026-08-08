import * as assert from 'assert';
import * as vscode from 'vscode';

import { checkoutRefWithStash } from '../../commands/utils/checkoutWithStashTail';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { AutoStashService } from '../../services/autoStashService';

const targetRef: IGitRef = { name: 'feature-x', fullName: 'feature-x', authorName: '', isTag: false };

function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    worktreeListDetailed: async () => [],
    isWorkdirHasChanges: async () => true,
    ...overrides,
  } as unknown as GitExecutor;
}

describe('checkoutRefWithStash', () => {
  it('skips the stash prompt on a clean tree and reports the outcome', async () => {
    let getAutoStashModeCalled = false;
    const autoStashService = {
      getAutoStashMode: async () => {
        getAutoStashModeCalled = true;
        return 'Auto stash and pop in new branch';
      },
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const result = await checkoutRefWithStash({
      git: makeGitStub({ isWorkdirHasChanges: async () => false }),
      currentBranch: 'main',
      targetRef,
      autoStashService,
    });

    assert.strictEqual(getAutoStashModeCalled, false);
    assert.strictEqual(result.outcome, 'completed');
    assert.strictEqual(result.autoStashMode, 'No auto stash');
  });

  it('aborts when the dirty-tree stash prompt is dismissed, without checking out', async () => {
    let checkoutCalled = false;
    const autoStashService = {
      getAutoStashMode: async () => undefined,
      checkoutAndStashChanges: async () => {
        checkoutCalled = true;
        return 'completed' as const;
      },
    } as unknown as AutoStashService;

    const result = await checkoutRefWithStash({
      git: makeGitStub(),
      currentBranch: 'main',
      targetRef,
      autoStashService,
    });

    assert.strictEqual(result.outcome, 'aborted');
    assert.strictEqual(checkoutCalled, false);
  });

  it('reports "worktreeConflict" and never checks out when the branch is checked out in another worktree', async () => {
    let checkoutCalled = false;
    const autoStashService = {
      getAutoStashMode: async () => 'Auto stash and pop in new branch',
      checkoutAndStashChanges: async () => {
        checkoutCalled = true;
        return 'completed' as const;
      },
    } as unknown as AutoStashService;

    const originalShowInformationMessage = vscode.window.showInformationMessage.bind(vscode.window);
    (vscode.window as any).showInformationMessage = async () => undefined;

    try {
      const result = await checkoutRefWithStash({
        git: makeGitStub({
          worktreeListDetailed: async () => [
            { path: '/other', branch: 'refs/heads/feature-x', bare: false, prunable: false },
          ],
        }),
        currentBranch: 'main',
        targetRef,
        autoStashService,
      });

      assert.strictEqual(result.outcome, 'worktreeConflict');
      assert.strictEqual(checkoutCalled, false);
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });

  it('delegates to checkoutAndStashChanges with the resolved mode when the tree is dirty', async () => {
    const calls: unknown[] = [];
    const autoStashService = {
      getAutoStashMode: async () => 'Auto stash and pop in new branch',
      checkoutAndStashChanges: async (...args: unknown[]) => {
        calls.push(args);
        return 'completed' as const;
      },
    } as unknown as AutoStashService;

    const git = makeGitStub();
    const result = await checkoutRefWithStash({
      git,
      currentBranch: 'main',
      targetRef,
      autoStashService,
    });

    assert.strictEqual(result.outcome, 'completed');
    assert.strictEqual(result.autoStashMode, 'Auto stash and pop in new branch');
    assert.deepStrictEqual(calls, [[git, 'main', targetRef, 'Auto stash and pop in new branch']]);
  });
});
