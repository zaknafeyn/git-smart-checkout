import { format } from 'date-fns';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import {
  PRReviewWorktreeRecord,
  PRReviewWorktreeRepoIdentity,
  PRReviewWorktreeStore,
} from '../../services/prReviewWorktreeStore';
import { BaseCommand } from '../command';
import {
  getWorktreeBranchName,
  normalizePathForComparison,
  removeWorkspaceFoldersForPath,
} from '../utils/worktreeRemoval';

const ACTION_STASH_AND_REMOVE = 'Stash Changes and Remove';
const ACTION_CANCEL = 'Cancel';

type DirtyAction = 'clean' | 'stash';
type PRReviewWorktreeQuickPickItem = vscode.QuickPickItem & {
  record: PRReviewWorktreeRecord;
  worktree: IGitWorktree;
};

export class RemovePRReviewInWorktreeCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private readonly store: PRReviewWorktreeStore,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);
      const selected = await this.selectPRReviewWorktree(git);

      if (!selected) {
        return;
      }

      const removed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: Remove PR review in Worktree',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Checking worktree...' });
          return await this.removeWorktree(git, selected.record, selected.worktree, progress);
        }
      );

      if (!removed) {
        return;
      }

      await removeWorkspaceFoldersForPath(selected.worktree.path);
      await this.store.remove(selected.record.id);
      await vscode.window.showInformationMessage(
        `PR #${selected.record.prNumber} worktree removed: ${selected.worktree.path}`,
        'OK'
      );
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async selectPRReviewWorktree(
    git: GitExecutor
  ): Promise<{ record: PRReviewWorktreeRecord; worktree: IGitWorktree } | undefined> {
    const identity = await this.getRepoIdentity(git);
    const worktrees = (await git.worktreeListDetailed()).filter(
      (worktree) => !worktree.bare && !worktree.prunable
    );
    const existingWorktreePaths = worktrees.map((worktree) => worktree.path);

    await this.store.removeMissingForRepository(identity, existingWorktreePaths);

    const records = await this.store.getForRepository(identity);
    const items = records
      .map((record): PRReviewWorktreeQuickPickItem | undefined => {
        const worktree = worktrees.find((item) => this.isSamePath(item.path, record.worktreePath));
        if (!worktree) {
          return undefined;
        }

        return {
          label: `#${record.prNumber} ${record.prTitle}`,
          description: getWorktreeBranchName(worktree.branch) ?? record.branchName,
          detail: record.worktreePath,
          record,
          worktree,
        };
      })
      .filter((item): item is PRReviewWorktreeQuickPickItem => Boolean(item));

    if (items.length === 0) {
      await vscode.window.showInformationMessage('No PR review worktrees found.', 'OK');
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Remove PR review in Worktree',
      placeHolder: 'Select a PR review worktree to remove',
    });

    return picked ? { record: picked.record, worktree: picked.worktree } : undefined;
  }

  private async removeWorktree(
    git: GitExecutor,
    record: PRReviewWorktreeRecord,
    worktree: IGitWorktree,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<boolean> {
    const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
    const hadChanges = await worktreeGit.isWorkdirHasChanges();
    let dirtyAction: DirtyAction = 'clean';

    if (hadChanges) {
      const confirmed = await this.confirmDirtyRemoval(record);
      if (!confirmed) {
        return false;
      }

      const stashName = await this.confirmStashName(record);
      if (!stashName) {
        return false;
      }

      dirtyAction = 'stash';
      progress.report({ message: 'Stashing changes...' });
      await worktreeGit.createStash(stashName, 'untracked');
    }

    progress.report({ message: 'Removing worktree...' });
    await git.worktreeRemove(worktree.path, false);
    capture(AnalyticsEvent.PrReviewWorktreeRemoved, {
      had_changes: hadChanges,
      dirty_action: dirtyAction,
    });

    return true;
  }

  private async confirmDirtyRemoval(record: PRReviewWorktreeRecord): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `PR #${record.prNumber} worktree "${record.branchName}" has uncommitted changes. Stash changes before removing it?`,
      { modal: true },
      ACTION_STASH_AND_REMOVE,
      ACTION_CANCEL
    );

    return choice === ACTION_STASH_AND_REMOVE;
  }

  private async confirmStashName(record: PRReviewWorktreeRecord): Promise<string | undefined> {
    const stashName = await vscode.window.showInputBox({
      title: 'Git Smart Checkout: Remove PR review in Worktree',
      prompt: 'Confirm stash name for the worktree changes',
      placeHolder: 'Stash name',
      value: this.getDefaultStashName(record.branchName),
      validateInput: (value) => {
        return value.trim() ? undefined : 'Stash name is required.';
      },
    });

    return stashName?.trim() || undefined;
  }

  private getDefaultStashName(branchName: string): string {
    const safeBranchName = branchName
      .replace(/[\\/]+/g, '-')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `${safeBranchName || 'worktree'}_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}`;
  }

  private async getRepoIdentity(git: GitExecutor): Promise<PRReviewWorktreeRepoIdentity> {
    const repoInfo = await git.getRepoInfo();
    return {
      repoKey: PRReviewWorktreeStore.createRepoKey(repoInfo?.owner, repoInfo?.repo, git.repositoryPath),
      repositoryPath: git.repositoryPath,
    };
  }

  private isSamePath(left: string, right: string): boolean {
    return normalizePathForComparison(left) === normalizePathForComparison(right);
  }
}
