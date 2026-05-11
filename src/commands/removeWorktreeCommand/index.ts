import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { getStashMessage } from '../utils/getStashMessage';
import { getWorktreeBranchName, removeWorkspaceFoldersForPath } from '../utils/worktreeRemoval';
import { BaseCommand } from '../command';

const ACTION_REMOVE_WORKTREE = 'Remove Worktree';
const ACTION_STASH_AND_REMOVE = 'Stash Changes and Remove';
const ACTION_RESET_AND_REMOVE = 'Reset Changes and Remove';
const ACTION_CANCEL = 'Cancel';

type DirtyAction = 'clean' | 'stash' | 'reset';
type WorktreeQuickPickItem = vscode.QuickPickItem & { worktree: IGitWorktree };

export class RemoveWorktreeCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);
      const worktree = await this.selectWorktree(git);

      if (!worktree) {
        return;
      }

      const removed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: Remove Worktree',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Checking worktree...' });
          return await this.removeWorktree(git, worktree, progress);
        }
      );

      if (!removed) {
        return;
      }

      await removeWorkspaceFoldersForPath(worktree.path);
      await vscode.window.showInformationMessage(`Worktree removed: ${worktree.path}`, 'OK');
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async selectWorktree(git: GitExecutor): Promise<IGitWorktree | undefined> {
    const worktrees = await git.worktreeListDetailed();
    const removableWorktrees = worktrees
      .slice(1)
      .filter((worktree) => !worktree.bare && !worktree.prunable);

    if (removableWorktrees.length === 0) {
      await vscode.window.showInformationMessage('No removable Git worktrees found.', 'OK');
      return undefined;
    }

    const items: WorktreeQuickPickItem[] = removableWorktrees.map((worktree) => ({
      label: this.getWorktreeLabel(worktree),
      description: worktree.path,
      detail: this.getWorktreeDetail(worktree),
      worktree,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Remove Worktree',
      placeHolder: 'Select a worktree to remove',
    });

    return picked?.worktree;
  }

  private async removeWorktree(
    git: GitExecutor,
    worktree: IGitWorktree,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<boolean> {
    const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
    const hadChanges = await worktreeGit.isWorkdirHasChanges();
    let dirtyAction: DirtyAction = 'clean';

    if (!hadChanges) {
      const confirmed = await this.confirmCleanRemoval(worktree);
      if (!confirmed) {
        return false;
      }
    } else {
      const action = await this.confirmDirtyRemoval(worktree);
      if (!action) {
        return false;
      }

      dirtyAction = action;
      if (action === 'stash') {
        progress.report({ message: 'Stashing changes...' });
        await worktreeGit.createStash(this.getStashName(worktree));
      } else {
        progress.report({ message: 'Resetting changes...' });
        await worktreeGit.discardAllWorktreeChanges();
      }
    }

    progress.report({ message: 'Removing worktree...' });
    await git.worktreeRemove(worktree.path, false);
    capture(AnalyticsEvent.WorktreeRemoved, { had_changes: hadChanges, dirty_action: dirtyAction });

    return true;
  }

  private async confirmCleanRemoval(worktree: IGitWorktree): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Remove worktree "${this.getWorktreeLabel(worktree)}" at ${worktree.path}?`,
      { modal: true },
      ACTION_REMOVE_WORKTREE,
      ACTION_CANCEL
    );

    return choice === ACTION_REMOVE_WORKTREE;
  }

  private async confirmDirtyRemoval(worktree: IGitWorktree): Promise<Exclude<DirtyAction, 'clean'> | undefined> {
    const choice = await vscode.window.showWarningMessage(
      `Worktree "${this.getWorktreeLabel(worktree)}" has uncommitted changes. What would you like to do before removing it?`,
      { modal: true },
      ACTION_STASH_AND_REMOVE,
      ACTION_RESET_AND_REMOVE,
      ACTION_CANCEL
    );

    if (choice === ACTION_STASH_AND_REMOVE) {
      return 'stash';
    }

    if (choice === ACTION_RESET_AND_REMOVE) {
      return 'reset';
    }

    return undefined;
  }

  private getWorktreeLabel(worktree: IGitWorktree): string {
    const branchName = this.getWorktreeBranchName(worktree);

    if (branchName) {
      return branchName;
    }

    if (worktree.detached) {
      return `Detached at ${this.getShortHead(worktree)}`;
    }

    return path.basename(worktree.path);
  }

  private getWorktreeDetail(worktree: IGitWorktree): string {
    if (worktree.detached) {
      return `Detached HEAD ${this.getShortHead(worktree)}`;
    }

    return worktree.head ? `HEAD ${this.getShortHead(worktree)}` : '';
  }

  private getStashName(worktree: IGitWorktree): string {
    return getStashMessage(
      this.getWorktreeBranchName(worktree) ??
        `detached-${worktree.head ? this.getShortHead(worktree) : path.basename(worktree.path)}`
    );
  }

  private getWorktreeBranchName(worktree: IGitWorktree): string | undefined {
    return getWorktreeBranchName(worktree.branch);
  }

  private getShortHead(worktree: IGitWorktree): string {
    return worktree.head?.slice(0, 7) ?? 'unknown';
  }
}
