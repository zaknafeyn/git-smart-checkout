import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../checkoutToCommand/constants';
import { TAutoStashMode } from '../checkoutToCommand/types';
import { getStashMessage } from '../utils/getStashMessage';
import { getRefDescription, getRefLabel } from '../utils/refFormatting';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';

const ACTION_ADD_TO_WORKSPACE = 'Add to Workspace';
const ACTION_OPEN_FOLDER = 'Open in Current Window';
const ACTION_OPEN_IN_NEW_WINDOW = 'Open in New Window';

type WorktreeBranchItem = vscode.QuickPickItem & { ref: IGitRef };

export class MoveToNewWorktreeCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);
      const currentBranch = await git.getCurrentBranch();

      if (!currentBranch) {
        throw new Error('Could not determine the current branch. Are you in a git repository?');
      }

      const targetBranch = await this.selectTargetBranch(git, currentBranch);
      if (!targetBranch) {
        return;
      }

      const worktreePath = await this.selectWorktreePath(git, targetBranch.name);
      if (!worktreePath) {
        return;
      }

      const isWorkdirHasChanges = await git.isWorkdirHasChanges();
      const autoStashMode = isWorkdirHasChanges
        ? await this.autoStashService.getAutoStashMode()
        : AUTO_STASH_IGNORE;

      if (!autoStashMode) {
        return;
      }

      const created = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git: Move to new worktree...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating worktree...' });
          return await this.createWorktreeWithStash(
            git,
            currentBranch,
            targetBranch,
            worktreePath,
            autoStashMode,
            isWorkdirHasChanges
          );
        }
      );

      if (!created) {
        return;
      }

      await this.showCompletionActions(worktreePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async selectTargetBranch(
    git: GitExecutor,
    currentBranch: string
  ): Promise<IGitRef | undefined> {
    const branchList = await git.getAllRefListExtended(this.configManager.get().refetchBeforeCheckout);
    const worktrees = await git.worktreeListDetailed(true);
    const checkedOutBranches = new Set(
      worktrees
        .map((worktree) => worktree.branch?.replace(/^refs\/heads\//, ''))
        .filter((branch): branch is string => Boolean(branch))
    );
    checkedOutBranches.add(currentBranch);

    const localBranchNames = new Set(
      branchList
        .filter((ref) => !ref.isTag && !ref.remote)
        .map((ref) => ref.name)
    );

    const refs = branchList.filter((ref) => {
      if (ref.isTag || ref.name === 'HEAD' || checkedOutBranches.has(ref.name)) {
        return false;
      }

      if (ref.remote) {
        return !localBranchNames.has(ref.name);
      }

      return true;
    });

    const locals = refs.filter((ref) => !ref.remote);
    const remotes = refs.filter((ref) => ref.remote);

    const toItem = (ref: IGitRef): WorktreeBranchItem => ({
      label: getRefLabel(ref),
      description: getRefDescription(ref),
      detail: ref.comment,
      ref,
    });

    const items: Array<vscode.QuickPickItem | WorktreeBranchItem> = [
      { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
      ...locals.map(toItem),
      { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
      ...remotes.map(toItem),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Move to new worktree',
      placeHolder: 'Select a target branch for the new worktree',
    });

    return (picked as WorktreeBranchItem | undefined)?.ref;
  }

  private async selectWorktreePath(
    git: GitExecutor,
    targetBranchName: string
  ): Promise<string | undefined> {
    const baseDirectory = this.getBaseWorktreeDirectory(git.repositoryPath);
    const suggestedDirectoryName = this.getSuggestedDirectoryName(
      git.repositoryPath,
      targetBranchName
    );

    const directoryName = await vscode.window.showInputBox({
      title: 'Move to new worktree',
      prompt: `Create worktree in ${baseDirectory}`,
      placeHolder: 'Worktree directory name',
      value: suggestedDirectoryName,
      validateInput: (value) => {
        const trimmed = value.trim();

        if (!trimmed) {
          return 'Worktree directory name is required.';
        }

        if (path.isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
          return 'Provide a folder name, not a path.';
        }

        const targetPath = path.join(baseDirectory, trimmed);
        if (fs.existsSync(targetPath)) {
          return 'A folder with this name already exists.';
        }

        return undefined;
      },
    });

    if (!directoryName) {
      return undefined;
    }

    return path.join(baseDirectory, directoryName.trim());
  }

  private getBaseWorktreeDirectory(repositoryPath: string): string {
    const configuredDirectory = this.configManager.get().defaultWorktreeDirectory.trim();
    const fallbackDirectory = path.dirname(repositoryPath);

    if (!configuredDirectory) {
      return fallbackDirectory;
    }

    const expandedDirectory = configuredDirectory.startsWith('~')
      ? path.join(process.env.HOME ?? '', configuredDirectory.slice(1))
      : configuredDirectory;

    return path.isAbsolute(expandedDirectory)
      ? expandedDirectory
      : path.resolve(fallbackDirectory, expandedDirectory);
  }

  private getSuggestedDirectoryName(repositoryPath: string, targetBranchName: string): string {
    const repositoryName = path.basename(repositoryPath);
    const safeBranchName = targetBranchName
      .replace(/[\\/]+/g, '-')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `${repositoryName}-${safeBranchName || 'worktree'}`;
  }

  private async createWorktreeWithStash(
    git: GitExecutor,
    currentBranch: string,
    targetBranch: IGitRef,
    worktreePath: string,
    autoStashMode: TAutoStashMode,
    isWorkdirHasChanges: boolean
  ): Promise<boolean> {
    const targetRef = targetBranch.remote ? targetBranch.fullName : targetBranch.name;
    const stashMessage = this.getWorktreeStashMessage(currentBranch, autoStashMode);

    if (
      isWorkdirHasChanges &&
      (autoStashMode === AUTO_STASH_AND_POP_IN_NEW_BRANCH ||
        autoStashMode === AUTO_STASH_AND_APPLY_IN_NEW_BRANCH)
    ) {
      const conflicts = await git.getStashConflictPreview(targetRef);
      if (conflicts.length > 0) {
        const proceed = await this.confirmStashConflicts(
          conflicts,
          autoStashMode === AUTO_STASH_AND_APPLY_IN_NEW_BRANCH ? 'apply' : 'pop'
        );

        if (!proceed) {
          return false;
        }
      }
    }

    if (isWorkdirHasChanges && autoStashMode !== AUTO_STASH_IGNORE) {
      await git.createStash(stashMessage);
    }

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await this.createWorktree(git, worktreePath, targetBranch);

    if (
      !isWorkdirHasChanges ||
      (autoStashMode !== AUTO_STASH_AND_POP_IN_NEW_BRANCH &&
        autoStashMode !== AUTO_STASH_AND_APPLY_IN_NEW_BRANCH)
    ) {
      return true;
    }

    const worktreeGit = new GitExecutor(worktreePath, this.logService, this.vscodeGitProvider);
    await worktreeGit.popStash(stashMessage, autoStashMode === AUTO_STASH_AND_APPLY_IN_NEW_BRANCH);

    return true;
  }

  private getWorktreeStashMessage(currentBranch: string, autoStashMode: TAutoStashMode): string {
    if (autoStashMode === AUTO_STASH_CURRENT_BRANCH) {
      return getStashMessage(currentBranch);
    }

    return getStashMessage(currentBranch, true);
  }

  private async createWorktree(
    git: GitExecutor,
    worktreePath: string,
    targetBranch: IGitRef
  ): Promise<void> {
    if (targetBranch.remote) {
      await git.worktreeAddRemoteBranch(worktreePath, targetBranch.name, targetBranch.fullName);
      return;
    }

    await git.worktreeAddLocalBranch(worktreePath, targetBranch.name);
  }

  private async confirmStashConflicts(files: string[], operation: string): Promise<boolean> {
    const fileList = files.map((file) => ` • ${file}`).join('\n');
    const message =
      `Creating the worktree will ${operation} a stash that conflicts with the target branch.\n\n` +
      `Conflicting files:\n${fileList}\n\n` +
      `Continue anyway? You will need to resolve conflicts manually in the new worktree.`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Continue',
      'Cancel'
    );

    return choice === 'Continue';
  }

  private async showCompletionActions(worktreePath: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Worktree created at ${worktreePath}`,
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
