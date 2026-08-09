import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import {
  collectPrunableWorktrees,
  formatPruneConfirmationDetail,
  PrunableWorktree,
} from '../../services/worktreePruneService';
import { refreshRemoveMultipleWorktreesVisibility } from '../utils/worktreeCommandVisibility';
import {
  getWorktreeLabel,
  getWorktreeStashName,
  removeWorkspaceFoldersForPath,
} from '../utils/worktreeRemoval';
import { BaseCommand } from '../command';

const ACTION_PRUNE = 'Prune Worktrees';
const ACTION_STASH_AND_PRUNE = 'Stash Changes and Prune';
const ACTION_RESET_AND_PRUNE = 'Reset Changes and Prune';
const ACTION_CANCEL = 'Cancel';
const ACTION_FORCE_DELETE_BRANCHES = 'Force Delete Branches';
const ACTION_KEEP_BRANCHES = 'Keep Branches';

type DirtyAction = 'clean' | 'stash' | 'reset';
type FailedPrune = { candidate: PrunableWorktree; error: string };

/** `git branch -d` refuses a branch that still holds commits the upstream never got. */
function isNotFullyMergedError(error: unknown): boolean {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string'
    ? (error as { stderr: string }).stderr
    : '';
  const message = error instanceof Error ? error.message : String(error);
  return /not fully merged/i.test(`${message}\n${stderr}`);
}

/**
 * Removes every worktree whose branch's upstream is gone (the remote branch was
 * deleted, typically once its PR merged) and deletes the now-dead local branch
 * along with it.
 */
export class PruneWorktreesCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider, 'Prune Worktrees');
      const candidates = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: Looking for worktrees to prune...',
          cancellable: false,
        },
        async () => collectPrunableWorktrees(git, this.logService, this.vscodeGitProvider)
      );

      if (candidates.length === 0) {
        await vscode.window.showInformationMessage(
          'No worktrees to prune. A worktree is prunable once its branch’s upstream is gone — ' +
            'that is, the remote branch has been deleted.',
          'OK'
        );
        return;
      }

      const dirtyCount = candidates.filter(({ dirtyFiles }) => dirtyFiles.length > 0).length;
      const dirtyAction = await this.confirmPrune(candidates, dirtyCount);
      if (!dirtyAction) {
        return;
      }

      const { pruned, unmerged, failed } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: Prune Worktrees',
          cancellable: false,
        },
        async (progress) => this.pruneWorktrees(git, candidates, dirtyAction, progress)
      );

      for (const { worktree } of pruned) {
        await removeWorkspaceFoldersForPath(worktree.path);
      }

      const forceDeleted = await this.resolveUnmergedBranches(git, unmerged);

      capture(AnalyticsEvent.WorktreesPruned, {
        count: pruned.length,
        had_dirty: dirtyCount > 0,
        dirty_action: dirtyAction,
        force_deleted_branches: forceDeleted.length,
      });

      await refreshRemoveMultipleWorktreesVisibility(this.logService, this.vscodeGitProvider);

      await this.reportResult(pruned, unmerged, forceDeleted, failed);
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async confirmPrune(
    candidates: PrunableWorktree[],
    dirtyCount: number
  ): Promise<DirtyAction | undefined> {
    const detail = formatPruneConfirmationDetail(candidates);
    const countLabel = `${candidates.length} worktree${candidates.length === 1 ? '' : 's'}`;

    if (dirtyCount === 0) {
      const choice = await vscode.window.showWarningMessage(
        `Prune ${countLabel} whose upstream branch is gone? Each worktree is removed and its local branch deleted.`,
        { modal: true, detail },
        ACTION_PRUNE,
        ACTION_CANCEL
      );

      return choice === ACTION_PRUNE ? 'clean' : undefined;
    }

    const choice = await vscode.window.showWarningMessage(
      `${countLabel} to prune, ${dirtyCount} with uncommitted changes. ` +
        'What would you like to do with the changes before pruning?',
      { modal: true, detail },
      ACTION_STASH_AND_PRUNE,
      ACTION_RESET_AND_PRUNE,
      ACTION_CANCEL
    );

    if (choice === ACTION_STASH_AND_PRUNE) {
      return 'stash';
    }

    if (choice === ACTION_RESET_AND_PRUNE) {
      return 'reset';
    }

    return undefined;
  }

  /**
   * Removes each worktree then deletes its branch with a non-force `git branch -d`.
   * A branch git refuses as not-fully-merged is collected rather than forced — the
   * caller asks before any commits are dropped. One worktree failing does not stop
   * the rest.
   */
  private async pruneWorktrees(
    git: GitExecutor,
    candidates: PrunableWorktree[],
    dirtyAction: DirtyAction,
    progress: vscode.Progress<{ message?: string }>
  ): Promise<{ pruned: PrunableWorktree[]; unmerged: PrunableWorktree[]; failed: FailedPrune[] }> {
    const pruned: PrunableWorktree[] = [];
    const unmerged: PrunableWorktree[] = [];
    const failed: FailedPrune[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const { worktree, branch, dirtyFiles } = candidate;
      progress.report({
        message: `Pruning ${getWorktreeLabel(worktree)} (${index + 1}/${candidates.length})...`,
      });

      try {
        if (dirtyFiles.length > 0 && dirtyAction !== 'clean') {
          const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
          if (dirtyAction === 'stash') {
            await worktreeGit.createStash(getWorktreeStashName(worktree));
          } else {
            await worktreeGit.discardAllWorktreeChanges();
          }
        }

        await git.worktreeRemove(worktree.path, false);
        pruned.push(candidate);
      } catch (error) {
        failed.push({ candidate, error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      try {
        await git.deleteBranch(branch, false);
      } catch (error) {
        if (isNotFullyMergedError(error)) {
          unmerged.push(candidate);
        } else {
          failed.push({ candidate, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return { pruned, unmerged, failed };
  }

  /** Offers a single force-delete for the branches `git branch -d` held back. */
  private async resolveUnmergedBranches(
    git: GitExecutor,
    unmerged: PrunableWorktree[]
  ): Promise<string[]> {
    if (unmerged.length === 0) {
      return [];
    }

    const detail = unmerged.map(({ branch }) => `• ${branch}`).join('\n');
    const choice = await vscode.window.showWarningMessage(
      `${unmerged.length} branch${unmerged.length === 1 ? ' was' : 'es were'} not fully merged, ` +
        'so the worktree was removed but the branch kept. Delete them anyway? Their unmerged commits will be lost.',
      { modal: true, detail },
      ACTION_FORCE_DELETE_BRANCHES,
      ACTION_KEEP_BRANCHES
    );

    if (choice !== ACTION_FORCE_DELETE_BRANCHES) {
      return [];
    }

    const deleted: string[] = [];
    for (const { branch } of unmerged) {
      try {
        await git.deleteBranch(branch, true);
        deleted.push(branch);
      } catch (error) {
        this.logService.warn(
          `[Prune Worktrees] Failed to force-delete branch ${branch}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return deleted;
  }

  private async reportResult(
    pruned: PrunableWorktree[],
    unmerged: PrunableWorktree[],
    forceDeleted: string[],
    failed: FailedPrune[]
  ): Promise<void> {
    if (pruned.length > 0) {
      const keptBranches = unmerged
        .map(({ branch }) => branch)
        .filter((branch) => !forceDeleted.includes(branch));
      const deletedCount = pruned.length - keptBranches.length;
      const lines = [
        `Pruned ${pruned.length} worktree${pruned.length === 1 ? '' : 's'}, ` +
          `deleted ${deletedCount} branch${deletedCount === 1 ? '' : 'es'}.`,
      ];
      if (keptBranches.length > 0) {
        lines.push(`Kept unmerged branch${keptBranches.length === 1 ? '' : 'es'}: ${keptBranches.join(', ')}.`);
      }
      await vscode.window.showInformationMessage(lines.join(' '), 'OK');
    }

    if (failed.length > 0) {
      const detail = failed
        .map(({ candidate, error }) => `${getWorktreeLabel(candidate.worktree)}: ${error}`)
        .join('\n');
      await vscode.window.showErrorMessage(
        `Failed to prune ${failed.length} worktree${failed.length === 1 ? '' : 's'}:\n${detail}`,
        'OK'
      );
    }
  }
}
