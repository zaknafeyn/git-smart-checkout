import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_CURRENT_BRANCH } from '../../commands/checkoutToCommand/constants';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { GitExecutor } from '../../common/git/gitExecutor';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    repositoryPath: '/repo',
    isWorkdirHasChanges: async () => true,
    createStash: async () => {},
    rebase: async () => {},
    popStash: async () => {},
    resetLocalChanges: async () => {},
    getConflictedFiles: async () => [],
    isMergeInProgress: async () => false,
    isCherryPickInProgress: async () => false,
    ...overrides,
  } as unknown as GitExecutor;
}

describe('AutoStashService.rebaseAndStashChanges', () => {
  it('does not discard post-rebase tracked changes: pops the stash directly without resetting the working tree', async () => {
    const resetCalls: number[] = [];
    const popCalls: string[] = [];
    const git = makeGitStub({
      // Dirty both before the stash and after a successful rebase — this must NOT be
      // wiped via `git restore .` before popping.
      isWorkdirHasChanges: async () => true,
      resetLocalChanges: (async () => {
        resetCalls.push(1);
      }) as unknown as GitExecutor['resetLocalChanges'],
      popStash: (async (msg: string) => {
        popCalls.push(msg);
      }) as unknown as GitExecutor['popStash'],
    });

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    await service.rebaseAndStashChanges(git, 'feature-x', 'main', AUTO_STASH_CURRENT_BRANCH);

    assert.deepStrictEqual(resetCalls, []);
    assert.strictEqual(popCalls.length, 1);
  });

  it('routes a conflicted post-rebase stash pop to the rescue flow instead of failing silently', async () => {
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async () => undefined;
    try {
      const git = makeGitStub({
        isWorkdirHasChanges: async () => true,
        popStash: async () => {
          throw new Error('CONFLICT (content): Merge conflict in file.ts');
        },
        getConflictedFiles: async () => ['file.ts'],
      });

      const service = new AutoStashService({} as ConfigurationManager, mockLogService);

      // Must resolve (not throw) — the rebase already succeeded, only the pop conflicted,
      // and git leaves the stash intact on a conflicted `stash pop`.
      await service.rebaseAndStashChanges(git, 'feature-x', 'main', AUTO_STASH_CURRENT_BRANCH);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('rethrows non-conflict pop errors', async () => {
    const git = makeGitStub({
      isWorkdirHasChanges: async () => true,
      popStash: async () => {
        throw new Error('No stash found');
      },
      getConflictedFiles: async () => [],
    });

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    await assert.rejects(
      () => service.rebaseAndStashChanges(git, 'feature-x', 'main', AUTO_STASH_CURRENT_BRANCH),
      /No stash found/
    );
  });
});
