import * as assert from 'assert';
import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { CopyWipChangesToWorktreeCommand } from '../../commands/copyChangesToWorktreeCommand';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('CopyWipChangesToWorktreeCommand preselected worktree (tree-view delegation)', () => {
  function makeGit(
    repositoryPath: string,
    worktrees: Array<{ path: string; head: string; branch?: string }>
  ): GitExecutor {
    return {
      repositoryPath,
      worktreeListDetailed: async () => worktrees,
    } as unknown as GitExecutor;
  }

  it('resolves a preselected worktree without showing a picker', async () => {
    const command = new CopyWipChangesToWorktreeCommand(mockLogService);
    const git = makeGit('/repo', [
      { path: '/repo', head: 'a', branch: 'refs/heads/main' },
      { path: '/repo-feature', head: 'b', branch: 'refs/heads/feature' },
    ]);

    const originalShowQuickPick = vscode.window.showQuickPick;
    let pickerShown = false;
    (vscode.window as any).showQuickPick = async () => {
      pickerShown = true;
      return undefined;
    };

    try {
      const worktree = await (command as any).selectWorktree(git, '/repo-feature');
      assert.strictEqual(worktree?.path, '/repo-feature');
      assert.strictEqual(pickerShown, false, 'should not open a QuickPick when the path is preselected');
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  it('excludes the currently open repository path from the preselected match', async () => {
    const command = new CopyWipChangesToWorktreeCommand(mockLogService);
    const git = makeGit('/repo', [{ path: '/repo', head: 'a', branch: 'refs/heads/main' }]);

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const messages: string[] = [];
    (vscode.window as any).showInformationMessage = async (message: string) => {
      messages.push(message);
      return undefined;
    };

    try {
      const worktree = await (command as any).selectWorktree(git, '/repo');
      assert.strictEqual(worktree, undefined);
      assert.deepStrictEqual(messages, ['No other Git worktrees available to copy changes to.']);
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });
});
