import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { getRepoId } from '../../utils/getRepoId';
import { BaseCommand } from '../command';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import {
  getRefDescription,
  getRefDetails,
  getRefLabel,
  getRefLabelWithStar,
  ICON_BRANCH,
  ICON_PLUS,
  ICON_REMOTE_BRANCH
} from '../utils/refFormatting';

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

    const repoId = await getRepoId(git);
    // Get the list of branches from the separate function
    const branchList = await this.getBranchList(git);
    const existingFullSet = new Set(
      branchList.map((ref) =>
        ref.isTag
          ? `refs/tags/${ref.name}`
          : ref.remote
          ? `refs/remotes/${ref.remote}/${ref.name}`
          : `refs/heads/${ref.name}`
      )
    );
    await this.configManager.cleanupMissing(repoId, existingFullSet);

    const [locals, remotes] = getMergedBranchLists(branchList, currentBranch);

    const quickPickActions = [
      { label: LABEL_CREATE_NEW_BRANCH },
      { label: LABEL_CREATE_NEW_BRANCH_FROM },
    ];

    const preferredLocal = locals.filter((b) => this.configManager.isPreferred(repoId, b));
    const preferredRemote = remotes.filter((b) => this.configManager.isPreferred(repoId, b));
    const nonPreferredLocal = locals.filter((b) => !this.configManager.isPreferred(repoId, b));
    const nonPreferredRemote = remotes.filter((b) => !this.configManager.isPreferred(repoId, b));
    const preferredTags = branchList.filter((t) => t.isTag && this.configManager.isPreferred(repoId, t));
    const otherTags = branchList.filter((t) => t.isTag && !this.configManager.isPreferred(repoId, t));

    const qp = vscode.window.createQuickPick<
      vscode.QuickPickItem & { ref?: IGitRef; type?: 'action' | 'ref' }
    >();
    qp.title = 'Checkout to...';
    qp.placeholder = 'Select a branch to checkout';

    const toItem = (ref: IGitRef): (vscode.QuickPickItem & { ref: IGitRef; type: 'ref' }) => ({
      label: getRefLabelWithStar(ref, this.configManager.isPreferred(repoId, ref)),
      description: getRefDescription(ref),
      detail: getRefDetails(ref),
      buttons: [
        {
          iconPath: new vscode.ThemeIcon(
            this.configManager.isPreferred(repoId, ref) ? 'star-full' : 'star'
          ),
          tooltip: this.configManager.isPreferred(repoId, ref) ? 'Unstar' : 'Star',
        },
      ],
      ref,
      type: 'ref',
    });

    const buildItems = () => {
      const items: (vscode.QuickPickItem & { ref?: IGitRef; type?: 'action' | 'ref' })[] = [];
      items.push(...quickPickActions.map((a) => ({ label: a.label, type: 'action' as const })));

      // if (preferredLocal.length > 0) {
      //   items.push({ label: 'Preferred branches', kind: vscode.QuickPickItemKind.Separator });
      //   items.push(...preferredLocal.map(toItem));
      // }

      // if (preferredRemote.length > 0) {
      //   items.push({ label: 'Preferred remote branches', kind: vscode.QuickPickItemKind.Separator });
      //   items.push(...preferredRemote.map(toItem));
      // }

      items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredLocal.map(toItem), ...nonPreferredLocal.map(toItem));

      items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredRemote.map(toItem), ...nonPreferredRemote.map(toItem));

      // if (preferredTags.length > 0) {
      //   items.push({ label: 'Preferred tags', kind: vscode.QuickPickItemKind.Separator });
      //   items.push(...preferredTags.map(toItem));
      // }
      items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredTags.map(toItem), ...otherTags.map(toItem));
      return items;
    };

    qp.items = buildItems();

    qp.onDidTriggerItemButton(async (e) => {
      const ref = (e.item as any).ref as IGitRef | undefined;
      if (!ref) {
        return;
      }
      await this.configManager.togglePreferred(repoId, ref, branchList);
      qp.items = buildItems();
    });

    const picked = await new Promise<
      | { kind: 'action'; label: string }
      | { kind: 'ref'; ref: IGitRef; label: string }
      | undefined
    >((resolve) => {
      qp.onDidAccept(() => {
        const sel = qp.selectedItems[0] as any;
        if (!sel) {
          resolve(undefined);
          qp.hide();
          return;
        }
        if (sel.type === 'action') {
          resolve({ kind: 'action', label: sel.label });
        } else if (sel.type === 'ref' && sel.ref) {
          resolve({ kind: 'ref', ref: sel.ref, label: sel.label });
        } else {
          resolve(undefined);
        }
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
    });

    if (!picked) {
      throw new Error();
    }

    if (picked.kind === 'action') {
      return {
        currentBranch,
        selection: picked.label,
        branchList,
      };
    }

    return {
      currentBranch,
      selection: getRefLabel(picked.ref),
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
