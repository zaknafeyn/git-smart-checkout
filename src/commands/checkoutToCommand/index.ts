import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { BaseCommand } from '../command';
import { IGitRef } from '../../common/git/types';
import {
  getRefDescription,
  getRefDetails,
  getRefLabel,
  ICON_BRANCH,
  ICON_PLUS,
  ICON_REMOTE_BRANCH,
} from '../utils/refFormatting';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';

export const LABEL_CREATE_NEW_BRANCH = `${ICON_PLUS} Create new branch...`;
export const LABEL_CREATE_NEW_BRANCH_FROM = `${ICON_PLUS} Create new branch from...`;

export class CheckoutToCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService
  ) {
    super(logService);
    this.logService = logService;
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor();

      const { currentBranch, selection, branchList } = await this.getSelectedOption(git);

      const newBranch = await this.getTargetBranch(git, selection, branchList);

      const autoStashMode = await this.autoStashService.getAutoStashMode();

      if (!autoStashMode) {
        return;
      }

      await this.autoStashService.checkoutAndStashChanges(
        git,
        currentBranch,
        newBranch,
        autoStashMode
      );
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message;
        message && (await vscode.window.showErrorMessage(message, 'OK'));
      } else {
        await vscode.window.showErrorMessage('Unknown error', 'OK');
      }
    }
  }

  async getBranchList(git: GitExecutor): Promise<IGitRef[]> {
    const { refetchBeforeCheckout } = this.configManager.get();

    // Only show progress if refetchBeforeCheckout is true
    if (refetchBeforeCheckout) {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout',
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({ message: 'Fetching branch list...' });
          progress.report({ message: 'Fetching from remotes...' });

          const branchList = await git.getAllRefListExtended(refetchBeforeCheckout);

          if (token.isCancellationRequested) {
            throw new Error('Operation was cancelled');
          }

          return branchList;
        }
      );
    } else {
      // No progress needed for local-only fetching
      return await git.getAllRefListExtended(refetchBeforeCheckout);
    }
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

    // Get the list of branches from the separate function
    const branchList = await this.getBranchList(git);

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

  async getTargetBranch(
    git: GitExecutor,
    selection: string,
    branchList: IGitRef[]
  ): Promise<IGitRef> {
    const iconsToRemove = [ICON_BRANCH, ICON_REMOTE_BRANCH];

    switch (true) {
      case selection === LABEL_CREATE_NEW_BRANCH:
        return await this.createNewBranch(git);
      case selection === LABEL_CREATE_NEW_BRANCH_FROM:
        return await this.createNewBranchFrom(git, branchList);
      default:
        const branchName = iconsToRemove.reduce(
          (prev, icon) => prev.replace(`${icon} `, ''),
          selection
        );
        const branch = branchList.find((ref) => ref.fullName === branchName);
        if (!branch) {
          throw new Error(`Cannot find appropriate object for a ref ${branchName}`);
        }

        return branch;
    }
  }

  async createNewBranch(git: GitExecutor): Promise<IGitRef> {
    const newBranchName = await vscode.window.showInputBox({
      placeHolder: 'Branch name',
      prompt: 'Please provide a new branch name',
    });

    if (!newBranchName) {
      throw new Error('New branch name is not provided.');
    }

    try {
      const newBranch = await git.createBranch(newBranchName);
      return newBranch;
    } catch (e) {
      await vscode.window.showErrorMessage('Failed to create the new branch.', 'OK');
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
      const newBranch = await git.createBranch(newBranchName, baseBranchName);
      return newBranch;
    } catch (e) {
      throw new Error('Failed to create the new branch.');
    }
  }
}
