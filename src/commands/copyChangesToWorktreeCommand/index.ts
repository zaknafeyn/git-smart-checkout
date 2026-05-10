import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

const ACTION_ADD_TO_WORKSPACE = 'Add to Workspace';
const ACTION_OPEN_FOLDER = 'Open in Current Window';
const ACTION_OPEN_IN_NEW_WINDOW = 'Open in New Window';
const ACTION_OK = 'OK';

type CopyMode = 'staged' | 'wip';
type WorktreeQuickPickItem = vscode.QuickPickItem & {
  worktree: IGitWorktree;
  hasChanges: boolean;
};

interface CopyResult {
  hadChanges: boolean;
  untrackedFileCount: number;
}

abstract class CopyChangesToWorktreeCommand extends BaseCommand {
  constructor(
    private mode: CopyMode,
    private progressTitle: string,
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

      const targetGit = new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider);
      if (await targetGit.isWorkdirHasChanges()) {
        await vscode.window.showWarningMessage(
          `Worktree "${this.getWorktreeLabel(worktree)}" has local changes. Choose a clean worktree before copying changes.`,
          ACTION_OK
        );
        return;
      }

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: this.progressTitle,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Preparing changes...' });
          return await this.copyChanges(git, targetGit, progress);
        }
      );

      capture(this.getAnalyticsEvent(), {
        had_changes: result.hadChanges,
        included_untracked: this.mode === 'wip',
        untracked_file_count: result.untrackedFileCount,
      });

      await this.showCompletionActions(worktree.path, result.hadChanges);
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
        'No other Git worktrees available to copy changes to.',
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
      title: this.getPickerTitle(),
      placeHolder: 'Select a worktree to copy changes to',
    });

    return picked?.worktree;
  }

  private async copyChanges(
    sourceGit: GitExecutor,
    targetGit: GitExecutor,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<CopyResult> {
    const stagedPatch = await sourceGit.getStagedChangesPatch();
    const unstagedPatch = this.mode === 'wip' ? await sourceGit.getUnstagedChangesPatch() : '';
    const untrackedFiles = this.mode === 'wip' ? await sourceGit.getUntrackedFiles() : [];
    const hadChanges =
      Boolean(stagedPatch.trim()) ||
      Boolean(unstagedPatch.trim()) ||
      untrackedFiles.length > 0;

    if (!hadChanges) {
      return {
        hadChanges: false,
        untrackedFileCount: 0,
      };
    }

    if (stagedPatch.trim()) {
      progress.report({ message: 'Copying staged changes...' });
      await targetGit.applyPatch(stagedPatch, { staged: true });
    }

    if (unstagedPatch.trim()) {
      progress.report({ message: 'Copying unstaged changes...' });
      await targetGit.applyPatch(unstagedPatch);
    }

    if (untrackedFiles.length > 0) {
      progress.report({ message: 'Copying untracked files...' });
      sourceGit.copyUntrackedFilesTo(targetGit.repositoryPath, untrackedFiles);
    }

    return {
      hadChanges: true,
      untrackedFileCount: untrackedFiles.length,
    };
  }

  private getPickerTitle(): string {
    return this.mode === 'staged'
      ? 'Copy staged changes to worktree'
      : 'Copy WIP changes to worktree';
  }

  private getAnalyticsEvent(): AnalyticsEvent {
    return this.mode === 'staged'
      ? AnalyticsEvent.CopyStagedChangesToWorktree
      : AnalyticsEvent.CopyWipChangesToWorktree;
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

  private async showCompletionActions(worktreePath: string, hadChanges: boolean): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      hadChanges ? `Changes copied to ${worktreePath}` : `No changes to copy. Worktree selected: ${worktreePath}`,
      ...this.getCompletionActions(worktreePath)
    );

    switch (action) {
      case ACTION_ADD_TO_WORKSPACE:
        this.addToWorkspace(worktreePath);
        break;
      case ACTION_OPEN_FOLDER:
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), false);
        break;
      case ACTION_OPEN_IN_NEW_WINDOW:
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
        break;
    }
  }

  private addToWorkspace(worktreePath: string): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    vscode.workspace.updateWorkspaceFolders(folders.length, null, {
      uri: vscode.Uri.file(worktreePath),
      name: path.basename(worktreePath),
    });
  }

  private getCompletionActions(worktreePath: string): string[] {
    const actions = [ACTION_OPEN_FOLDER, ACTION_OPEN_IN_NEW_WINDOW];

    if (!this.isWorktreeInWorkspace(worktreePath)) {
      actions.unshift(ACTION_ADD_TO_WORKSPACE);
    }

    return actions;
  }

  private isWorktreeInWorkspace(worktreePath: string): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) =>
      this.isSamePath(folder.uri.fsPath, worktreePath)
    );
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

export class CopyStagedChangesToWorktreeCommand extends CopyChangesToWorktreeCommand {
  constructor(logService: LoggingService, vscodeGitProvider?: VscodeGitProvider) {
    super(
      'staged',
      'Git: Copy staged changes to worktree ...',
      logService,
      vscodeGitProvider
    );
  }
}

export class CopyWipChangesToWorktreeCommand extends CopyChangesToWorktreeCommand {
  constructor(logService: LoggingService, vscodeGitProvider?: VscodeGitProvider) {
    super('wip', 'Git: Copy WIP changes to worktree ...', logService, vscodeGitProvider);
  }
}
