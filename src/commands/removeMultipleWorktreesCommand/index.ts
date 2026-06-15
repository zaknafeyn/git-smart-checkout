import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { refreshRemoveMultipleWorktreesVisibility } from '../utils/worktreeCommandVisibility';
import {
  getRemovableWorktrees,
  getWorktreeDetail,
  getWorktreeLabel,
  getWorktreeStashName,
  removeWorkspaceFoldersForPath,
} from '../utils/worktreeRemoval';
import { BaseCommand } from '../command';

const ACTION_REMOVE_ALL = 'Remove All Worktrees';
const ACTION_STASH_ALL_AND_REMOVE = 'Stash Changes and Remove All';
const ACTION_RESET_ALL_AND_REMOVE = 'Reset Changes and Remove All';
const ACTION_CANCEL = 'Cancel';

type DirtyAction = 'clean' | 'stash' | 'reset';
type WorktreeQuickPickItem = vscode.QuickPickItem & { worktree: IGitWorktree };
type FailedRemoval = { worktree: IGitWorktree; error: string };

export class RemoveMultipleWorktreesCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider, 'Remove Multiple Worktrees');
      const removable = getRemovableWorktrees(await git.worktreeListDetailed());

      if (removable.length < 2) {
        await vscode.window.showInformationMessage(
          'Need at least two removable Git worktrees to remove multiple at once.',
          'OK'
        );
        return;
      }

      const selected = await this.selectWorktrees(removable);
      if (!selected || selected.length === 0) {
        return;
      }

      const dirtyPaths = await this.findDirtyWorktreePaths(selected);
      const dirtyAction = await this.confirmRemoval(selected, dirtyPaths);
      if (!dirtyAction) {
        return;
      }

      const { removed, failed } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: Remove Multiple Worktrees',
          cancellable: false,
        },
        async (progress) => this.removeWorktrees(git, selected, dirtyPaths, dirtyAction, progress)
      );

      for (const worktree of removed) {
        await removeWorkspaceFoldersForPath(worktree.path);
      }

      capture(AnalyticsEvent.MultipleWorktreesRemoved, {
        count: removed.length,
        had_dirty: dirtyPaths.size > 0,
        dirty_action: dirtyAction,
      });

      await refreshRemoveMultipleWorktreesVisibility(this.logService, this.vscodeGitProvider);

      await this.reportResult(removed, failed);
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async selectWorktrees(worktrees: IGitWorktree[]): Promise<IGitWorktree[] | undefined> {
    const items: WorktreeQuickPickItem[] = worktrees.map((worktree) => ({
      label: getWorktreeLabel(worktree),
      description: worktree.path,
      detail: getWorktreeDetail(worktree),
      worktree,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Remove Multiple Worktrees',
      placeHolder: 'Check the worktrees to remove',
      canPickMany: true,
    });

    return picked?.map((item) => item.worktree);
  }

  private async findDirtyWorktreePaths(worktrees: IGitWorktree[]): Promise<Set<string>> {
    const dirty = new Set<string>();

    for (const worktree of worktrees) {
      const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
      if (await worktreeGit.isWorkdirHasChanges()) {
        dirty.add(worktree.path);
      }
    }

    return dirty;
  }

  private async confirmRemoval(
    selected: IGitWorktree[],
    dirtyPaths: Set<string>
  ): Promise<DirtyAction | undefined> {
    const detail = this.formatWorktreeList(selected);

    if (dirtyPaths.size === 0) {
      const choice = await vscode.window.showWarningMessage(
        `Remove ${selected.length} worktrees?`,
        { modal: true, detail },
        ACTION_REMOVE_ALL,
        ACTION_CANCEL
      );

      return choice === ACTION_REMOVE_ALL ? 'clean' : undefined;
    }

    const choice = await vscode.window.showWarningMessage(
      `${selected.length} worktrees selected, ${dirtyPaths.size} with uncommitted changes. ` +
        'What would you like to do with the changes before removing all?',
      { modal: true, detail },
      ACTION_STASH_ALL_AND_REMOVE,
      ACTION_RESET_ALL_AND_REMOVE,
      ACTION_CANCEL
    );

    if (choice === ACTION_STASH_ALL_AND_REMOVE) {
      return 'stash';
    }

    if (choice === ACTION_RESET_ALL_AND_REMOVE) {
      return 'reset';
    }

    return undefined;
  }

  private async removeWorktrees(
    git: GitExecutor,
    selected: IGitWorktree[],
    dirtyPaths: Set<string>,
    dirtyAction: DirtyAction,
    progress: vscode.Progress<{ message?: string }>
  ): Promise<{ removed: IGitWorktree[]; failed: FailedRemoval[] }> {
    const removed: IGitWorktree[] = [];
    const failed: FailedRemoval[] = [];

    for (const [index, worktree] of selected.entries()) {
      const label = getWorktreeLabel(worktree);
      progress.report({ message: `Removing ${label} (${index + 1}/${selected.length})...` });

      try {
        if (dirtyPaths.has(worktree.path) && dirtyAction !== 'clean') {
          const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
          if (dirtyAction === 'stash') {
            await worktreeGit.createStash(getWorktreeStashName(worktree));
          } else {
            await worktreeGit.discardAllWorktreeChanges();
          }
        }

        await git.worktreeRemove(worktree.path, false);
        removed.push(worktree);
      } catch (error) {
        failed.push({ worktree, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { removed, failed };
  }

  private async reportResult(removed: IGitWorktree[], failed: FailedRemoval[]): Promise<void> {
    if (removed.length > 0) {
      await vscode.window.showInformationMessage(
        `Removed ${removed.length} worktree${removed.length === 1 ? '' : 's'}.`,
        'OK'
      );
    }

    if (failed.length > 0) {
      const detail = failed
        .map(({ worktree, error }) => `${getWorktreeLabel(worktree)}: ${error}`)
        .join('\n');
      await vscode.window.showErrorMessage(
        `Failed to remove ${failed.length} worktree${failed.length === 1 ? '' : 's'}:\n${detail}`,
        'OK'
      );
    }
  }

  private formatWorktreeList(worktrees: IGitWorktree[]): string {
    return worktrees.map((worktree) => `• ${getWorktreeLabel(worktree)} (${worktree.path})`).join('\n');
  }
}
