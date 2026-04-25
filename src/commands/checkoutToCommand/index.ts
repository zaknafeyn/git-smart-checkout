import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
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
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
    this.logService = logService;
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);

      const { currentBranch, selection, branchList } = await this.getSelectedOption(git);

      const newBranch = await this.getTargetBranch(git, selection, branchList);

      const isNewBranch =
        selection === LABEL_CREATE_NEW_BRANCH ||
        selection === LABEL_CREATE_NEW_BRANCH_FROM;

      if (!isNewBranch) {
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
      }
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
    const { useFastBranchList } = this.configManager.get();

    // Mutable branch list — upgraded in-place when Phase 2 resolves.
    let branchList: IGitRef[] = [];

    const qp = vscode.window.createQuickPick<
      vscode.QuickPickItem & { ref?: IGitRef; type?: 'action' | 'ref' }
    >();
    qp.title = 'Checkout to...';
    qp.placeholder = 'Select a branch to checkout';

    const quickPickActions = [
      { label: LABEL_CREATE_NEW_BRANCH },
      { label: LABEL_CREATE_NEW_BRANCH_FROM },
    ];

    const toItem = (ref: IGitRef): (vscode.QuickPickItem & { ref: IGitRef; type: 'ref' }) => {
      const isPreferred = this.configManager.isPreferred(repoId, ref);

      return {
        label: getRefLabelWithStar(ref, isPreferred),
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
      };
    };

    const buildItems = () => {
      const [locals, remotes] = getMergedBranchLists(branchList, currentBranch);
      const preferredLocal = locals.filter((b) => this.configManager.isPreferred(repoId, b));
      const preferredRemote = remotes.filter((b) => this.configManager.isPreferred(repoId, b));
      const nonPreferredLocal = locals.filter((b) => !this.configManager.isPreferred(repoId, b));
      const nonPreferredRemote = remotes.filter((b) => !this.configManager.isPreferred(repoId, b));
      const preferredTags = branchList.filter((t) => t.isTag && this.configManager.isPreferred(repoId, t));
      const otherTags = branchList.filter((t) => t.isTag && !this.configManager.isPreferred(repoId, t));

      const items: (vscode.QuickPickItem & { ref?: IGitRef; type?: 'action' | 'ref' })[] = [];
      items.push(...quickPickActions.map((a) => ({ label: a.label, type: 'action' as const })));
      items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredLocal.map(toItem), ...nonPreferredLocal.map(toItem));
      items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredRemote.map(toItem), ...nonPreferredRemote.map(toItem));
      items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
      items.push(...preferredTags.map(toItem), ...otherTags.map(toItem));
      return items;
    };

    qp.onDidTriggerItemButton(async (e) => {
      const ref = (e.item as any).ref as IGitRef | undefined;
      if (!ref) {
        return;
      }
      await this.configManager.togglePreferred(repoId, ref, branchList);
      qp.items = buildItems();
    });

    // Promise that resolves when the user makes a selection (or dismisses).
    let resolveSelection!: (
      value:
        | { kind: 'action'; label: string }
        | { kind: 'ref'; ref: IGitRef; label: string }
        | undefined
    ) => void;
    const selectionPromise = new Promise<
      | { kind: 'action'; label: string }
      | { kind: 'ref'; ref: IGitRef; label: string }
      | undefined
    >((resolve) => {
      resolveSelection = resolve;
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
    });

    // Phase 1: seed picker immediately from VS Code's cached git model.
    const fastRefs = useFastBranchList ? await git.getAllRefListFast() : undefined;
    if (fastRefs && fastRefs.length > 0) {
      branchList = fastRefs;
      qp.items = buildItems();
      qp.busy = true;
      qp.show();
    }

    // Phase 2: fetch full data (may include a network fetch when refetchBeforeCheckout is on).
    // Fire-and-forget — updates the picker when ready.
    let phase2Error: Error | undefined;
    const phase2Done = this.getBranchList(git)
      .then((richRefs) => {
        branchList = richRefs;
        qp.items = buildItems();
        qp.busy = false;

        const existingFullSet = new Set(
          richRefs.map((ref) =>
            ref.isTag
              ? `refs/tags/${ref.name}`
              : ref.remote
              ? `refs/remotes/${ref.remote}/${ref.name}`
              : `refs/heads/${ref.name}`
          )
        );
        this.configManager.cleanupMissing(repoId, existingFullSet);

        if (!fastRefs || fastRefs.length === 0) {
          qp.items = buildItems();
          qp.show();
        }
      })
      .catch((err) => {
        phase2Error = err instanceof Error ? err : new Error(String(err));
        if (!fastRefs || fastRefs.length === 0) {
          // No fast data was ever shown — propagate by resolving the selection as cancelled.
          resolveSelection(undefined);
        }
      });

    // Await user selection (picker is already visible or will appear when Phase 2 resolves).
    const picked = await selectionPromise;
    qp.dispose();

    // If we had no fast data and Phase 2 failed, surface the error.
    if (phase2Error && (!fastRefs || fastRefs.length === 0)) {
      throw phase2Error;
    }

    // Suppress unused-promise lint warning — we intentionally don't await phase2Done here.
    void phase2Done;

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
      const msg = e instanceof Error ? e.message : String(e);
      await vscode.window.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
      throw new Error(`Failed to create the new branch: ${msg}`);
    }
  }

  async createNewBranchFrom(git: GitExecutor, branchList: IGitRef[]) {
    const baseBranchList = branchList.map((branch) => `${ICON_BRANCH} ${branch.fullName}`);
    const baseBranchName = await vscode.window.showQuickPick(baseBranchList, {
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

    const strippedBase = baseBranchName.replace(/^\$\([^)]*\)\s*/, '');

    try {
      const dirty = await git.isWorkdirHasChanges();
      const stashName = `smart-checkout-new-branch-${Date.now()}`;
      if (dirty) {
        await git.createStash(stashName);
      }
      const newBranch = await git.createBranch(newBranchName, strippedBase);
      if (dirty) {
        try {
          await git.popStash(stashName);
        } catch {
          // conflicts are left for the user to resolve
        }
      }
      return newBranch;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to create the new branch: ${msg}`);
    }
  }
}
