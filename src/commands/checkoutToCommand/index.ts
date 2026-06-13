import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { getFullRefname } from '../../common/git/refName';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { RefDetailsCache } from '../../services/refDetailsCache';
import { getRepoId } from '../../utils/getRepoId';
import { BaseCommand } from '../command';
import { attachLazyEnrichment } from '../utils/enrichOnActive';
import { prepareInitialRefDetails, refreshRemainingRefDetails } from '../utils/refDetailsPrefetch';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import {
  getRefDescription,
  getRefDetails,
  getRefLabel,
  getRefLabelWithStar,
  ICON_STAR_FILLED,
  ICON_FOLDER,
  ICON_PLUS
} from '../utils/refFormatting';
import { findWorktreeForBranch, handleWorktreeBranchConflict } from '../utils/worktreeBranchConflict';

export const LABEL_CREATE_NEW_BRANCH = `${ICON_PLUS} Create new branch...`;
export const LABEL_CREATE_NEW_BRANCH_FROM = `${ICON_PLUS} Create new branch from...`;

export class CheckoutToCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider,
    private refDetailsCache?: RefDetailsCache
  ) {
    super(logService);
    this.logService = logService;
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);

      const { currentBranch, selection, selectedRef, branchList } =
        await this.getSelectedOption(git);

      const isNewBranch =
        selection === LABEL_CREATE_NEW_BRANCH ||
        selection === LABEL_CREATE_NEW_BRANCH_FROM;

      // For an existing ref the accepted quick-pick item already carries the
      // full IGitRef, so use it directly instead of resolving from a display
      // label (which broke tags, whose label is "$(tag) v1.2.3").
      const newBranch = selectedRef ?? (await this.getTargetBranch(git, selection, branchList));

      if (!isNewBranch) {
        const conflictWorktree = await findWorktreeForBranch(git, newBranch.name);
        if (conflictWorktree) {
          const result = await handleWorktreeBranchConflict(newBranch.fullName, conflictWorktree.path);
          if (result.action === 'createBranch') {
            try {
              await git.createBranch(result.newBranchName, newBranch.fullName);
              capture(AnalyticsEvent.BranchCreated);
            } catch (e) {
              captureException(e);
              const msg = e instanceof Error ? e.message : String(e);
              await vscode.window.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
            }
          }
          return;
        }

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

  async getSelectedOption(
    git: GitExecutor
  ): Promise<{
    currentBranch: string;
    selection: string;
    selectedRef?: IGitRef;
    branchList: IGitRef[];
  }> {
    let currentBranch = '';
    try {
      currentBranch = await git.getCurrentBranch();
    } catch (e) {
      throw new Error('The current workspace is not a git repository.');
    }

    const repoId = await getRepoId(git);
    const { useFastBranchList } = this.configManager.get();
    const checkedOutBranchNames = new Set(
      (await git.worktreeListDetailed(true))
        .filter((worktree) => !worktree.bare && !worktree.prunable && worktree.branch)
        .map((worktree) => worktree.branch?.replace(/^refs\/heads\//, ''))
        .filter((branch): branch is string => Boolean(branch))
    );

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
      const isCheckedOutInWorktree = !ref.remote && !ref.isTag && checkedOutBranchNames.has(ref.name);
      const isPreferred = this.configManager.isPreferred(repoId, ref);
      // Star first (stays visible at all times), then the worktree folder icon, then the ref label.
      const label = [
        isPreferred ? ICON_STAR_FILLED : undefined,
        isCheckedOutInWorktree ? ICON_FOLDER : undefined,
        getRefLabel(ref),
      ]
        .filter(Boolean)
        .join(' ');

      return {
        label,
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
      const tags = branchList.filter((t) => t.isTag);
      // Preferred refs float to the top of each section, ordered by when they were starred.
      const preferredLocal = this.configManager.sortByPreferredOrder(
        repoId,
        locals.filter((b) => this.configManager.isPreferred(repoId, b))
      );
      const preferredRemote = this.configManager.sortByPreferredOrder(
        repoId,
        remotes.filter((b) => this.configManager.isPreferred(repoId, b))
      );
      const preferredTags = this.configManager.sortByPreferredOrder(
        repoId,
        tags.filter((t) => this.configManager.isPreferred(repoId, t))
      );
      const nonPreferredLocal = locals.filter((b) => !this.configManager.isPreferred(repoId, b));
      const nonPreferredRemote = remotes.filter((b) => !this.configManager.isPreferred(repoId, b));
      const otherTags = tags.filter((t) => !this.configManager.isPreferred(repoId, t));

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
    const selectionPromise = new Promise<
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
    });

    // Load the ref list from VS Code's cached git model (instant, no spawned git).
    // Highlighted items are enriched lazily via the VS Code API. When the fast
    // path is unavailable (built-in git ext not ready, or disabled via setting),
    // fall back to a local `git for-each-ref` listing — already fully enriched.
    const fastRefs = useFastBranchList ? await git.getAllRefListFast() : undefined;
    let enrichSub: vscode.Disposable | undefined;
    if (fastRefs && fastRefs.length > 0) {
      branchList = fastRefs;
      await prepareInitialRefDetails({
        repoKey: git.repositoryPath,
        refs: branchList,
        git,
        cache: this.refDetailsCache,
        buildItems,
      });
      enrichSub = attachLazyEnrichment({
        quickPick: qp,
        git,
        rebuild: buildItems,
        repoKey: git.repositoryPath,
        cache: this.refDetailsCache,
      });
    } else {
      branchList = await git.getAllRefListExtended();
      void this.refDetailsCache?.upsertFromRefs(git.repositoryPath, branchList);
    }

    qp.items = buildItems();
    qp.show();
    if (fastRefs && fastRefs.length > 0) {
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

    // Drop preferred-ref entries for branches/tags that no longer exist.
    // The list (fast or fallback) contains all refs, so the set is complete.
    const existingFullSet = new Set(branchList.map((ref) => getFullRefname(ref)));
    void this.configManager.cleanupMissing(repoId, existingFullSet);

    const picked = await selectionPromise;
    qp.dispose();
    enrichSub?.dispose();

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
      selectedRef: picked.ref,
      branchList,
    };
  }

  async getTargetBranch(
    git: GitExecutor,
    selection: string,
    branchList: IGitRef[]
  ): Promise<IGitRef> {
    switch (selection) {
      case LABEL_CREATE_NEW_BRANCH:
        return await this.createNewBranch(git);
      case LABEL_CREATE_NEW_BRANCH_FROM:
        return await this.createNewBranchFrom(git, branchList);
      default:
        throw new Error(`Cannot find appropriate object for a ref ${selection}`);
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
      capture(AnalyticsEvent.BranchCreated);
      return newBranch;
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      await vscode.window.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
      throw new Error(`Failed to create the new branch: ${msg}`);
    }
  }

  async createNewBranchFrom(git: GitExecutor, branchList: IGitRef[]) {
    const repoId = await getRepoId(git);
    const baseRef = await this.pickBaseRef(branchList, repoId);

    if (!baseRef) {
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
      const dirty = await git.isWorkdirHasChanges();
      const stashName = `smart-checkout-new-branch-${Date.now()}`;
      if (dirty) {
        await git.createStash(stashName);
      }
      const newBranch = await git.createBranch(newBranchName, baseRef.fullName);
      capture(AnalyticsEvent.BranchCreated);
      if (dirty) {
        try {
          await git.popStash(stashName);
        } catch {
          // conflicts are left for the user to resolve
        }
      }
      return newBranch;
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to create the new branch: ${msg}`);
    }
  }

  /**
   * Pick a ref to base a new branch on. Mirrors the main checkout picker:
   * refs are grouped (local / remote / tags), preferred refs float to the top
   * of each group, and the inline star button toggles a ref's preferred state.
   */
  private async pickBaseRef(
    branchList: IGitRef[],
    repoId: string
  ): Promise<IGitRef | undefined> {
    const qp = vscode.window.createQuickPick<
      vscode.QuickPickItem & { ref?: IGitRef }
    >();
    qp.title = 'Create new branch from...';
    qp.placeholder = 'Select a branch to base the new branch on';

    const toItem = (ref: IGitRef): vscode.QuickPickItem & { ref: IGitRef } => ({
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
    });

    const buildItems = () => {
      const locals = branchList.filter((b) => !b.isTag && !b.remote);
      const remotes = branchList.filter((b) => !b.isTag && b.remote);
      const tags = branchList.filter((b) => b.isTag);
      const split = (refs: IGitRef[]) => {
        const preferred = this.configManager.sortByPreferredOrder(
          repoId,
          refs.filter((r) => this.configManager.isPreferred(repoId, r))
        );
        const rest = refs.filter((r) => !this.configManager.isPreferred(repoId, r));
        return [...preferred, ...rest];
      };

      const items: (vscode.QuickPickItem & { ref?: IGitRef })[] = [];
      items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...split(locals).map(toItem));
      items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
      items.push(...split(remotes).map(toItem));
      items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
      items.push(...split(tags).map(toItem));
      return items;
    };

    qp.onDidTriggerItemButton(async (e) => {
      const ref = (e.item as { ref?: IGitRef }).ref;
      if (!ref) {
        return;
      }
      await this.configManager.togglePreferred(repoId, ref, branchList);
      qp.items = buildItems();
    });

    const selectionPromise = new Promise<IGitRef | undefined>((resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems[0]?.ref);
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
    });

    qp.items = buildItems();
    qp.show();

    const picked = await selectionPromise;
    qp.dispose();
    return picked;
  }
}
