import { QuickPickItem, window } from "vscode";
import { AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, AUTO_STASH_AND_POP_IN_NEW_BRANCH, AUTO_STASH_CURRENT_BRANCH, AUTO_STASH_IGNORE, AUTO_STASH_PREFIX, DESC_AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, DESC_AUTO_STASH_AND_POP_IN_NEW_BRANCH, DESC_AUTO_STASH_CURRENT_BRANCH, DESC_AUTO_STASH_IGNORE } from "../commands/checkoutToCommand/constants";
import { TAutoStashMode } from "../commands/checkoutToCommand/types";
import { ConfigurationManager } from "../configuration/configurationManager";
import { AUTO_STASH_MODE_APPLY, AUTO_STASH_MODE_BRANCH, AUTO_STASH_MODE_MANUAL, AUTO_STASH_MODE_POP } from "../configuration/extensionConfig";
import { LoggingService } from "../logging/loggingService";
import { showQuickPick } from "../commands/utils/showQuickPick";
import { GitExecutor } from "../common/git/gitExecutor";
import { getStashMessage } from "../commands/utils/getStashMessage";
import { IGitRef } from "../common/git/types";
import { handleErrorMessage } from "../utils/handleErrorMessage";
import { capture, captureException } from "../analytics/analytics";

export class AutoStashService {
  
  constructor(
    private configManager: ConfigurationManager,
    private logService: LoggingService
  ) { }

  async getAutoStashMode(): Promise<TAutoStashMode | undefined> {
    const { mode } = this.configManager.get();

    if (mode === AUTO_STASH_MODE_BRANCH) {
      return AUTO_STASH_CURRENT_BRANCH;
    }

    if (mode === AUTO_STASH_MODE_POP) {
      return AUTO_STASH_AND_POP_IN_NEW_BRANCH;
    }

    if (mode === AUTO_STASH_MODE_APPLY) {
      return AUTO_STASH_AND_APPLY_IN_NEW_BRANCH;
    }

    if (mode !== AUTO_STASH_MODE_MANUAL) {
      // if config mode isn't set to 'manual', skip manual selection of stash mode
      return;
    }

    const autoStashModeQuickPickItems: QuickPickItem[] = [
      {
        label: AUTO_STASH_CURRENT_BRANCH,
        detail: DESC_AUTO_STASH_CURRENT_BRANCH,
      },
      {
        label: AUTO_STASH_AND_POP_IN_NEW_BRANCH,
        detail: DESC_AUTO_STASH_AND_POP_IN_NEW_BRANCH,
      },
      {
        label: AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
        detail: DESC_AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
      },
      {
        label: AUTO_STASH_IGNORE,
        detail: DESC_AUTO_STASH_IGNORE,
      },
    ];

    const autoStashMode = await showQuickPick(autoStashModeQuickPickItems, {
      placeHolder: 'Select auto stash mode',
    });

    this.logService.info(`Selected mode: ${autoStashMode?.label}`);

    return autoStashMode?.label as TAutoStashMode;
  }

  async checkoutAndStashChanges(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: IGitRef,
    autoStashMode: TAutoStashMode = AUTO_STASH_CURRENT_BRANCH
  ) {
    const nextBranchName = nextBranch.name;
    const isWorkdirHasChanges = await git.isWorkdirHasChanges();
    switch (autoStashMode) {
      case AUTO_STASH_CURRENT_BRANCH:
        await this.doAutoStashCurrentBranch(git, currentBranch, nextBranchName, isWorkdirHasChanges);
        break;
      case AUTO_STASH_AND_POP_IN_NEW_BRANCH:
        await this.doAutoStashAndPopInNewBranch(
          git,
          currentBranch,
          nextBranchName,
          isWorkdirHasChanges
        );
        break;
      case AUTO_STASH_AND_APPLY_IN_NEW_BRANCH:
        await this.doAutoStashAndPopInNewBranch(
          git,
          currentBranch,
          nextBranchName,
          isWorkdirHasChanges,
          true
        );
        break;
      case AUTO_STASH_IGNORE:
      default:
        try {
          await git.checkout(nextBranchName);
          if (await git.hasUpstreamBranch(nextBranchName)) {
            await git.pullCurrentBranch();
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to checkout the selected branch: ${msg}`);
        }
        break;
    }
    capture('checkout_to_branch', { stash_mode: autoStashMode, had_changes: isWorkdirHasChanges });
  }

  async doAutoStashCurrentBranch(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: string,
    isWorkdirHasChanges: boolean
  ) {
    try {
      if (isWorkdirHasChanges) {
        const stashMessage = getStashMessage(currentBranch);
        await git.createStash(stashMessage);
      }
    } catch (e) {
      handleErrorMessage(e);
    }

    try {
      await git.checkout(nextBranch);
      if (await git.hasUpstreamBranch(nextBranch)) {
        await git.pullCurrentBranch();
      }
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to checkout the selected branch: ${msg}`);
    }

    try {
      const message = `${AUTO_STASH_PREFIX}-${nextBranch}`;
      const isStashWithMessageExists = await git.isStashWithMessageExists(message);
      this.logService.info(
        `Stash is ${isStashWithMessageExists ? 'found' : 'not found'} for stash with message: '${message}'`
      );
      if (isStashWithMessageExists) {
        await git.popStash(message);
      }
    } catch (e) {
      handleErrorMessage(e, 'No stash found', 'No stash to pop on the new branch.', 'Failed to pop the stash on the new branch.');
    }
  }

  async #confirmStashConflicts(files: string[], operation: string): Promise<boolean> {
    const fileList = files.map(f => ` • ${f}`).join('\n');
    const message =
      `Switching branches will ${operation} a stash that conflicts with the target branch.\n\n` +
      `Conflicting files:\n${fileList}\n\n` +
      `Continue anyway? You will need to resolve conflicts manually after checkout.`;
    const choice = await window.showWarningMessage(message, { modal: true }, 'Continue', 'Cancel');
    return choice === 'Continue';
  }

  async doAutoStashAndPopInNewBranch(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: string,
    isWorkdirHasChanges: boolean,
    apply: boolean = false
  ) {
    const stashMessage = getStashMessage(currentBranch, true);
    const operation = apply ? 'apply' : 'pop';

    try {
      if (isWorkdirHasChanges) {
        const conflicts = await git.getStashConflictPreview(nextBranch);
        if (conflicts.length > 0) {
          const proceed = await this.#confirmStashConflicts(conflicts, operation);
          if (!proceed) {
            this.logService.info('User cancelled checkout due to predicted stash conflicts');
            return;
          }
        }
        await git.createStash(stashMessage);
      }
    } catch (e) {
      handleErrorMessage(e);
    }

    try {
      await git.checkout(nextBranch);
      if (await git.hasUpstreamBranch(nextBranch)) {
        await git.pullCurrentBranch();
      }
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to checkout the selected branch: ${msg}`);
    }

    // nothing to pop if no changes were stashed before checkout
    if (!isWorkdirHasChanges) {
      return;
    }

    // Pop or apply the stash on the new branch
    try {
      const isStashWithMessageExists = await git.isStashWithMessageExists(stashMessage);
      if (isStashWithMessageExists) {
        await git.popStash(stashMessage, apply);
      }
    } catch (e) {
      handleErrorMessage(e, 'No stash found', `No stash to ${operation} on the new branch.`, `Failed to ${operation} the stash on the new branch.`);
    }
  }
}
