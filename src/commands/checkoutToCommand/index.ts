import * as vscode from 'vscode';
import { format } from 'date-fns';

import { GitExecutor } from '../../common/git/gitExecutor';
import { getWorkspaceFoldersFormatted } from '../../common/vscode';
import { BaseCommand } from '../command';
import { IGitRef } from '../../common/git/types';
import {
  getRefDescription,
  getRefDetails,
  getRefLabel,
  ICON_BRANCH,
  ICON_PLUS,
} from '../utils/refFormatting';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
  AUTO_STASH_PREFIX,
  DESC_AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  DESC_AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  DESC_AUTO_STASH_CURRENT_BRANCH,
  DESC_AUTO_STASH_IGNORE,
} from './constants';
import { TAutoStashMode } from './types';

export const LABEL_CREATE_NEW_BRANCH = `${ICON_PLUS} Create new branch...`;
export const LABEL_CREATE_NEW_BRANCH_FROM = `${ICON_PLUS} Create new branch from...`;

export class CheckoutToCommand extends BaseCommand {
  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor();

      const { currentBranch, selection, branchList } = await this.getSelectedOption(git);

      const newBranch = await this.getTargetBranch(git, selection, branchList);

      const autoStashMode = await this.getAutoStashMode();

      if (!autoStashMode) {
        return;
      }

      await this.checkoutAndStashChanges(git, currentBranch, newBranch, autoStashMode);
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message;
        message && vscode.window.showErrorMessage(message);
      } else {
        vscode.window.showErrorMessage('Unknown error');
      }
    }
  }

  async getGitExecutor() {
    const wsFolders = getWorkspaceFoldersFormatted();

    if (!wsFolders || wsFolders.length === 0) {
      throw new Error('There is no projects in current workspace.');
    }

    if (wsFolders.length === 1) {
      return new GitExecutor(wsFolders[0].path);
    }

    const repositoryOptions: vscode.QuickPickItem[] = wsFolders.map((wsf) => ({
      label: wsf.name,
    }));

    const selectedOption = await this.showQuickPick(repositoryOptions, {
      placeHolder: 'Choose a repository',
      title: 'Checkout to ...',
    });

    if (!selectedOption) {
      throw new Error('No repository selected');
    }

    const repository = wsFolders.find(({ name }) => name === selectedOption.label);

    return new GitExecutor(repository!.path);
  }

  async getSelectedOption(
    git: GitExecutor
  ): Promise<{ currentBranch: string; selection: string; branchList: IGitRef[] }> {
    let currentBranch = '';
    try {
      currentBranch = await git.getCurrentBranch();
    } catch (e) {
      throw new Error('The current workspace is not a git repository.');
    }

    // Get the list of branches in current repo and show user a quick pick list
    const branchList = await git.getAllRefListExtended();

    const [locals, remotes] = getMergedBranchLists(branchList, currentBranch);

    const quickPickTags = branchList
      .filter((branch) => branch.isTag)
      .map((tag) => ({
        label: getRefLabel(tag),
        description: getRefDescription(tag),
        detail: getRefDetails(tag),
      }));

    const quickPickActions = [
      { label: LABEL_CREATE_NEW_BRANCH },
      { label: LABEL_CREATE_NEW_BRANCH_FROM },
    ];

    const quicPickItems: vscode.QuickPickItem[] = [
      ...quickPickActions,
      {
        label: 'Branches',
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...locals.map((branch) => ({
        label: getRefLabel(branch),
        description: getRefDescription(branch),
        detail: getRefDetails(branch),
      })),
      {
        label: 'Remote branches',
        kind: vscode.QuickPickItemKind.Separator,
      },

      ...remotes.map((branch) => ({
        label: getRefLabel(branch),
        description: getRefDescription(branch),
        detail: getRefDetails(branch),
      })),

      {
        label: 'Tags',
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...quickPickTags,
    ];

    // Show the quick pick list
    const pickedItem = await vscode.window.showQuickPick(quicPickItems, {
      // Options
      placeHolder: 'Select a branch to checkout',
    });

    // If the user didn't select anything, return
    if (!pickedItem) {
      throw new Error();
    }

    return {
      currentBranch,
      selection: pickedItem.label,
      branchList,
    };
  }

  async getTargetBranch(git: GitExecutor, selection: string, branchList: IGitRef[]) {
    switch (true) {
      case selection === LABEL_CREATE_NEW_BRANCH:
        return await this.createNewBranch(git);
      case selection === LABEL_CREATE_NEW_BRANCH_FROM:
        return await this.createNewBranchFrom(git, branchList);
      default:
        return selection.replace(`${ICON_BRANCH} `, '');
    }
  }

  async createNewBranch(git: GitExecutor) {
    const newBranchName = await vscode.window.showInputBox({
      placeHolder: 'Branch name',
      prompt: 'Please provide a new branch name',
    });

    if (!newBranchName) {
      throw new Error('New branch name is not provided.');
    }

    try {
      await git.createBranch(newBranchName);
      return newBranchName;
    } catch (e) {
      vscode.window.showErrorMessage('Failed to create the new branch.');
      throw new Error('Failed to create the new branch.');
    }
  }

  async createNewBranchFrom(git: GitExecutor, branchList: IGitRef[]) {
    const baseBranchList = branchList.map((branch) => `${ICON_BRANCH} ${branch.fullName}`);
    const baseBranchName = await vscode.window.showQuickPick(baseBranchList, {
      // Options
      placeHolder: 'Select a branch to base the new branch on',
    });

    if (!baseBranchName) {
      throw new Error('Base branch name is not provided.');
    }

    const newBranchName = await vscode.window.showInputBox({
      placeHolder: 'Branch name',
      prompt: 'Please provide a new branch name',
    });

    if (!newBranchName) {
      throw new Error('New branch name is not provided.');
    }

    try {
      await git.createBranch(newBranchName, baseBranchName);

      return newBranchName;
    } catch (e) {
      throw new Error('Failed to create the new branch.');
    }
  }

  async getAutoStashMode(): Promise<TAutoStashMode | undefined> {
    const autoStashModeQuickPickItems: vscode.QuickPickItem[] = [
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

    const autoStashMode = await this.showQuickPick(autoStashModeQuickPickItems, {
      placeHolder: 'Select auto stash mode',
    });

    return autoStashMode?.label as TAutoStashMode;
  }

  async checkoutAndStashChanges(
    git: GitExecutor,
    currentBranch: string,
    newBranch: string,
    autoStashMode: TAutoStashMode = AUTO_STASH_CURRENT_BRANCH
  ) {
    const isWorkdirHasChanges = await git.isWorkdirHasChanges();
    switch (autoStashMode) {
      case AUTO_STASH_CURRENT_BRANCH:
        await this.doAutoStashCurrentBranch(git, currentBranch, newBranch, isWorkdirHasChanges);
        break;
      case AUTO_STASH_AND_POP_IN_NEW_BRANCH:
        await this.doAutoStashAndPopInNewBranch(git, currentBranch, newBranch, isWorkdirHasChanges);
        break;
      case AUTO_STASH_AND_APPLY_IN_NEW_BRANCH:
        await this.doAutoStashAndPopInNewBranch(
          git,
          currentBranch,
          newBranch,
          isWorkdirHasChanges,
          true
        );
        break;
      case AUTO_STASH_IGNORE:
      default:
        try {
          await git.checkout(newBranch);
        } catch (e) {
          throw new Error('Failed to checkout the selected branch.');
        }
        break;
    }
  }

  async doAutoStashCurrentBranch(
    git: GitExecutor,
    currentBranch: string,
    newBranch: string,
    isWorkdirHasChanges: boolean
  ) {
    try {
      if (isWorkdirHasChanges) {
        await git.createStash(`${AUTO_STASH_PREFIX}-${currentBranch}`, true);
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
      await git.checkout(newBranch);
    } catch (e) {
      throw new Error('Failed to checkout the selected branch.');
    }

    try {
      const message = `${AUTO_STASH_PREFIX}-${newBranch}`;
      const isStashWithMessageExists = await git.isStashWithMessageExists(message);
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
    newBranch: string,
    isWorkdirHasChanges: boolean,
    apply: boolean = false
  ) {
    const stashMessage = `${AUTO_STASH_PREFIX}-${currentBranch}-${format(Date.now(), 'yyyy-MM-ddThh:mm:ss')}`;
    try {
      if (isWorkdirHasChanges) {
        await git.createStash(stashMessage, true);
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
      await git.checkout(newBranch);
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
