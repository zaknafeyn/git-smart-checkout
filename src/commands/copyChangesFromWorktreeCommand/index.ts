import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

const ACTION_APPLY_ANYWAY = 'Apply Anyway';
const ACTION_CANCEL = 'Cancel';
const ACTION_MOVE_WIP = 'Move WIP';
const ACTION_OK = 'OK';

type TransferMode = 'copy' | 'move';
type WorktreeQuickPickItem = vscode.QuickPickItem & {
  worktree: IGitWorktree;
  hasChanges: boolean;
};

interface WipChanges {
  stagedPatch: string;
  unstagedPatch: string;
  untrackedFiles: string[];
  hadChanges: boolean;
}

interface TransferResult {
  hadChanges: boolean;
  targetHadChanges: boolean;
  untrackedFileCount: number;
}

abstract class CopyChangesFromWorktreeCommand extends BaseCommand {
  constructor(
    private mode: TransferMode,
    private progressTitle: string,
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const targetGit = await this.getGitExecutor(this.vscodeGitProvider);
      const worktree = await this.selectWorktree(targetGit);

      if (!worktree) {
        return;
      }

      const sourceGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
      const changes = await this.collectWipChanges(sourceGit);
      const targetHadChanges = await targetGit.isWorkdirHasChanges();

      if (!changes.hadChanges) {
        capture(this.getAnalyticsEvent(), {
          had_changes: false,
          target_had_changes: targetHadChanges,
          untracked_file_count: 0,
        });
        await vscode.window.showInformationMessage(
          `No WIP changes to ${this.mode}. Worktree selected: ${worktree.path}`,
          ACTION_OK
        );
        return;
      }

      if (targetHadChanges && !(await this.confirmApplyIntoDirtyTarget())) {
        return;
      }

      if (this.mode === 'move' && !(await this.confirmMove(worktree))) {
        return;
      }

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: this.progressTitle,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Applying WIP changes...' });
          await this.applyWipChanges(sourceGit, targetGit, changes, progress);

          if (this.mode === 'move') {
            progress.report({ message: 'Cleaning source worktree...' });
            await sourceGit.discardAllWorktreeChanges();
          }

          return {
            hadChanges: true,
            targetHadChanges,
            untrackedFileCount: changes.untrackedFiles.length,
          };
        }
      );

      capture(this.getAnalyticsEvent(), {
        had_changes: result.hadChanges,
        target_had_changes: result.targetHadChanges,
        untracked_file_count: result.untrackedFileCount,
      });

      await vscode.window.showInformationMessage(
        this.mode === 'move'
          ? `WIP changes moved from ${worktree.path}`
          : `WIP changes copied from ${worktree.path}`,
        ACTION_OK
      );
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, ACTION_OK));
    }
  }

  private async selectWorktree(git: GitExecutor): Promise<IGitWorktree | undefined> {
    const worktrees = await git.worktreeListDetailed();
    const selectableWorktrees = worktrees.filter(
      (worktree) =>
        !worktree.bare &&
        !worktree.prunable &&
        !this.isSamePath(worktree.path, git.repositoryPath)
    );

    if (selectableWorktrees.length === 0) {
      await vscode.window.showInformationMessage(
        `No other Git worktrees available to ${this.mode} WIP changes from.`,
        ACTION_OK
      );
      return undefined;
    }

    const items = await Promise.all(
      selectableWorktrees.map(async (worktree): Promise<WorktreeQuickPickItem> => {
        const worktreeGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
        const hasChanges = await worktreeGit.isWorkdirHasChanges();

        return {
          label: this.getWorktreeLabel(worktree),
          description: `${hasChanges ? '$(warning) Has changes' : '$(check) Clean'} - ${worktree.path}`,
          detail: this.getWorktreeDetail(worktree),
          worktree,
          hasChanges,
        };
      })
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: this.mode === 'move' ? 'Move WIP from Worktree' : 'Copy WIP from Worktree',
      placeHolder: 'Select a worktree to copy WIP changes from',
    });

    return picked?.worktree;
  }

  private async collectWipChanges(sourceGit: GitExecutor): Promise<WipChanges> {
    const stagedPatch = await sourceGit.getStagedChangesPatch();
    const unstagedPatch = await sourceGit.getUnstagedChangesPatch();
    const untrackedFiles = await sourceGit.getUntrackedFiles();
    const hadChanges =
      Boolean(stagedPatch.trim()) ||
      Boolean(unstagedPatch.trim()) ||
      untrackedFiles.length > 0;

    return {
      stagedPatch,
      unstagedPatch,
      untrackedFiles,
      hadChanges,
    };
  }

  private async applyWipChanges(
    sourceGit: GitExecutor,
    targetGit: GitExecutor,
    changes: WipChanges,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    if (changes.stagedPatch.trim()) {
      progress.report({ message: 'Copying staged changes...' });
      await targetGit.applyPatch(changes.stagedPatch, { staged: true });
    }

    if (changes.unstagedPatch.trim()) {
      progress.report({ message: 'Copying unstaged changes...' });
      await targetGit.applyPatch(changes.unstagedPatch);
    }

    if (changes.untrackedFiles.length > 0) {
      progress.report({ message: 'Copying untracked files...' });
      sourceGit.copyUntrackedFilesTo(targetGit.repositoryPath, changes.untrackedFiles);
    }
  }

  private async confirmApplyIntoDirtyTarget(): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      'The current worktree has local changes. Applying WIP from another worktree may fail or overlap with your current changes.',
      { modal: true },
      ACTION_APPLY_ANYWAY,
      ACTION_CANCEL
    );

    return choice === ACTION_APPLY_ANYWAY;
  }

  private async confirmMove(worktree: IGitWorktree): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Move WIP changes from "${this.getWorktreeLabel(worktree)}" into the current worktree and reset the source worktree at ${worktree.path}?`,
      { modal: true },
      ACTION_MOVE_WIP,
      ACTION_CANCEL
    );

    return choice === ACTION_MOVE_WIP;
  }

  private getAnalyticsEvent(): AnalyticsEvent {
    return this.mode === 'move'
      ? AnalyticsEvent.MoveWipChangesFromWorktree
      : AnalyticsEvent.CopyWipChangesFromWorktree;
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

  private getWorktreeBranchName(worktree: IGitWorktree): string | undefined {
    return worktree.branch?.replace(/^refs\/heads\//, '');
  }

  private getShortHead(worktree: IGitWorktree): string {
    return worktree.head?.slice(0, 7) ?? 'unknown';
  }

  private isSamePath(left: string, right: string): boolean {
    return this.normalizePathForComparison(left) === this.normalizePathForComparison(right);
  }

  private normalizePathForComparison(targetPath: string): string {
    try {
      return fs.realpathSync.native(targetPath);
    } catch {
      try {
        return path.join(
          fs.realpathSync.native(path.dirname(targetPath)),
          path.basename(targetPath)
        );
      } catch {
        return path.resolve(targetPath);
      }
    }
  }
}

export class CopyWipChangesFromWorktreeCommand extends CopyChangesFromWorktreeCommand {
  constructor(logService: LoggingService, vscodeGitProvider?: VscodeGitProvider) {
    super('copy', 'Git: Copy WIP from Worktree', logService, vscodeGitProvider);
  }
}

export class MoveWipChangesFromWorktreeCommand extends CopyChangesFromWorktreeCommand {
  constructor(logService: LoggingService, vscodeGitProvider?: VscodeGitProvider) {
    super('move', 'Git: Move WIP from Worktree', logService, vscodeGitProvider);
  }
}
