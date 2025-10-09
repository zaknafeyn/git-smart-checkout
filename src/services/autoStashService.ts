import { QuickPickItem } from "vscode";
import { AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, AUTO_STASH_AND_POP_IN_NEW_BRANCH, AUTO_STASH_CURRENT_BRANCH, AUTO_STASH_IGNORE, AUTO_STASH_PREFIX, DESC_AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, DESC_AUTO_STASH_AND_POP_IN_NEW_BRANCH, DESC_AUTO_STASH_CURRENT_BRANCH, DESC_AUTO_STASH_IGNORE } from "../commands/checkoutToCommand/constants";
import { TAutoStashMode } from "../commands/checkoutToCommand/types";
import { ConfigurationManager } from "../configuration/configurationManager";
import { AUTO_STASH_MODE_APPLY, AUTO_STASH_MODE_BRANCH, AUTO_STASH_MODE_MANUAL, AUTO_STASH_MODE_POP } from "../configuration/extensionConfig";
import { LoggingService } from "../logging/loggingService";
import { showQuickPick } from "../commands/utils/showQuickPick";
import { GitExecutor } from "../common/git/gitExecutor";
import { getStashMessage } from "../commands/utils/getStashMessage";
import { IGitRef } from "../common/git/types";

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
      // this means that, below code is executed only when config mode is 'manual'
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
          throw new Error('Failed to checkout the selected branch.');
        }
        break;
    }
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
      if (e instanceof Error) {
        if (e.message === 'No local changes to save') {
          throw new Error('No local changes to stash.');
        } else {
          throw new Error('Failed to stash the current changes.');
        }
      } else {
        throw new Error('Failed to stash the current changes.');
      }
    }

    try {
      await git.checkout(nextBranch);
      if (await git.hasUpstreamBranch(nextBranch)) {
        await git.pullCurrentBranch();
      }
    } catch (e) {
      throw new Error('Failed to checkout the selected branch.');
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
      if (e instanceof Error) {
        if (e.message === `No stash found`) {
          throw new Error('No stash to pop on the new branch.');
        } else {
          throw new Error('Failed to pop the stash on the new branch.');
        }
      } else {
        throw new Error('Failed to pop the stash on the new branch.');
      }
    }
  }

  async doAutoStashAndPopInNewBranch(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: string,
    isWorkdirHasChanges: boolean,
    apply: boolean = false
  ) {
    const stashMessage = getStashMessage(currentBranch, true);

    try {
      if (isWorkdirHasChanges) {
        await git.createStash(stashMessage);
      }
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'No local changes to save') {
          throw new Error('No local changes to stash.');
        } else {
          throw new Error('Failed to stash the current changes.');
        }
      } else {
        throw new Error('Failed to stash the current changes.');
      }
    }

    // Checkout the selected branch
    try {
      await git.checkout(nextBranch);
      if (await git.hasUpstreamBranch(nextBranch)) {
        await git.pullCurrentBranch();
      }
    } catch (e) {
      throw new Error('Failed to checkout the selected branch.');
    }

    const operation = apply ? 'apply' : 'pop';

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
      if (e instanceof Error) {
        if (e.message === `No stash found`) {
          throw new Error(`No stash to ${operation} on the new branch.`);
        } else {
          throw new Error(`Failed to ${operation} the stash on the new branch.`);
        }
      } else {
        throw new Error(`Failed to ${operation} the stash on the new branch.`);
      }
    }
  }
}
