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
import { AnalyticsEvent, capture } from '../../analytics/analytics';
import { getStashMessage } from '../utils/getStashMessage';
import { getRefDescription, getRefLabel } from '../utils/refFormatting';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { RefDetailsCache } from '../../services/refDetailsCache';
import { BaseCommand } from '../command';
import { attachLazyEnrichment } from '../utils/enrichOnActive';
import { prepareInitialRefDetails, refreshRemainingRefDetails } from '../utils/refDetailsPrefetch';
import { showWorktreeCompletionActions } from '../utils/worktreeCompletionActions';
import { selectWorktreePath } from '../utils/worktreePath';

type WorktreeBranchItem = vscode.QuickPickItem & { ref?: IGitRef };

export class MoveToNewWorktreeCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider,
    private refDetailsCache?: RefDetailsCache
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

      const worktreePath = await selectWorktreePath(
        git.repositoryPath,
        targetBranch.name,
        this.configManager.get().defaultWorktreeDirectory,
        'Move to new worktree'
      );
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
          title: 'Git Smart Checkout: Move to new worktree...',
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

      capture(AnalyticsEvent.MoveToNewWorktree, {
        stash_mode: autoStashMode,
        had_changes: isWorkdirHasChanges,
        target_is_remote: Boolean(targetBranch.remote),
      });

      await showWorktreeCompletionActions(worktreePath, `Worktree created at ${worktreePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async selectTargetBranch(
    git: GitExecutor,
    currentBranch: string
  ): Promise<IGitRef | undefined> {
    const { useFastBranchList } = this.configManager.get();

    // Load instantly from VS Code's cached model; fall back to a local listing.
    let branchList: IGitRef[];
    let useEnrichment = false;
    const fastRefs = useFastBranchList ? await git.getAllRefListFast() : undefined;
    if (fastRefs && fastRefs.length > 0) {
      branchList = fastRefs;
      useEnrichment = true;
    } else {
      branchList = await git.getAllRefListExtended();
      void this.refDetailsCache?.upsertFromRefs(git.repositoryPath, branchList);
    }

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

    const buildItems = (): WorktreeBranchItem[] => [
      { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
      ...locals.map(toItem),
      { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
      ...remotes.map(toItem),
    ];

    const qp = vscode.window.createQuickPick<WorktreeBranchItem>();
    qp.title = 'Move to new worktree';
    qp.placeholder = 'Select a target branch for the new worktree';
    if (useEnrichment) {
      await prepareInitialRefDetails({
        repoKey: git.repositoryPath,
        refs: branchList,
        git,
        cache: this.refDetailsCache,
        buildItems,
      });
    }
    qp.items = buildItems();

    const enrichSub = useEnrichment
      ? attachLazyEnrichment({
        quickPick: qp,
        git,
        rebuild: buildItems,
        repoKey: git.repositoryPath,
        cache: this.refDetailsCache,
      })
      : undefined;

    const picked = await new Promise<IGitRef | undefined>((resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems[0]?.ref);
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
      if (useEnrichment) {
        refreshRemainingRefDetails({
          repoKey: git.repositoryPath,
          refs: branchList,
          git,
          cache: this.refDetailsCache,
          buildItems,
          quickPick: qp,
          rebuild: buildItems,
        });
      }
    });

    qp.dispose();
    enrichSub?.dispose();

    return picked;
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

}
