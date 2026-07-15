import * as assert from 'assert';
import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { RemoveWorktreeCommand } from '../../commands/removeWorktreeCommand';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('RemoveWorktreeCommand preselected worktree (tree-view delegation)', () => {
  function makeGit(worktrees: Array<{ path: string; head: string; branch?: string }>): GitExecutor {
    return { worktreeListDetailed: async () => worktrees } as unknown as GitExecutor;
  }

  it('resolves a preselected removable worktree without showing a picker', async () => {
    const command = new RemoveWorktreeCommand(mockLogService);
    const git = makeGit([
      { path: '/repo', head: 'a', branch: 'refs/heads/main' },
      { path: '/repo-feature', head: 'b', branch: 'refs/heads/feature' },
    ]);

    const originalShowQuickPick = vscode.window.showQuickPick;
    let pickerShown = false;
    (vscode.window as any).showQuickPick = async (...args: unknown[]) => {
      pickerShown = true;
      return originalShowQuickPick.apply(vscode.window, args as any);
    };

    try {
      const worktree = await (command as any).selectWorktree(git, '/repo-feature');
      assert.strictEqual(worktree?.path, '/repo-feature');
      assert.strictEqual(pickerShown, false, 'should not open a QuickPick when the path is preselected');
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  it('falls back to the picker when the preselected path is not a removable worktree', async () => {
    const command = new RemoveWorktreeCommand(mockLogService);
    const git = makeGit([
      { path: '/repo', head: 'a', branch: 'refs/heads/main' },
      { path: '/repo-feature', head: 'b', branch: 'refs/heads/feature' },
    ]);

    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined;

    try {
      const worktree = await (command as any).selectWorktree(git, '/does-not-exist');
      assert.strictEqual(worktree, undefined);
    } finally {
      (vscode.window as any).showQuickPick = originalShowQuickPick;
    }
  });

  it('reports no removable worktrees when only the main worktree exists', async () => {
    const command = new RemoveWorktreeCommand(mockLogService);
    const git = makeGit([{ path: '/repo', head: 'a', branch: 'refs/heads/main' }]);

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const messages: string[] = [];
    (vscode.window as any).showInformationMessage = async (message: string) => {
      messages.push(message);
      return undefined;
    };

    try {
      const worktree = await (command as any).selectWorktree(git, '/repo');
      assert.strictEqual(worktree, undefined);
      assert.deepStrictEqual(messages, ['No removable Git worktrees found.']);
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });
});
