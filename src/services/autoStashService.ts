import { QuickPickItem, window } from "vscode";
import { AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, AUTO_STASH_AND_POP_IN_NEW_BRANCH, AUTO_STASH_CURRENT_BRANCH, AUTO_STASH_IGNORE, AUTO_STASH_PREFIX, DESC_AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, DESC_AUTO_STASH_AND_POP_IN_NEW_BRANCH, DESC_AUTO_STASH_CURRENT_BRANCH, DESC_AUTO_STASH_IGNORE } from "../commands/checkoutToCommand/constants";
import { TAutoStashMode } from "../commands/checkoutToCommand/types";
import { ConfigurationManager } from "../configuration/configurationManager";
import { AUTO_STASH_MODE_APPLY, AUTO_STASH_MODE_BRANCH, AUTO_STASH_MODE_MANUAL, AUTO_STASH_MODE_POP, PULL_AFTER_CHECKOUT_FF_ONLY, PULL_AFTER_CHECKOUT_OFF, PULL_AFTER_CHECKOUT_PULL } from "../configuration/extensionConfig";
import { LoggingService } from "../logging/loggingService";
import { showQuickPick } from "../commands/utils/showQuickPick";
import { GitExecutor } from "../common/git/gitExecutor";
import { getStashMessage } from "../commands/utils/getStashMessage";
import { IGitRef } from "../common/git/types";
import { handleErrorMessage } from "../utils/handleErrorMessage";
import { AnalyticsEvent, capture, captureException } from "../analytics/analytics";
import { VscodeGitProvider } from "../common/git/vscodeGitProvider";
import { offerConflictRescue } from './stashConflictRescue';

export type TPullWithStashStrategy = 'merge' | 'rebase';

export type CheckoutOutcome = 'completed' | 'cancelled' | 'rescued';

export class AutoStashService {

  constructor(
    private configManager: ConfigurationManager,
    private logService: LoggingService,
    private onStashCarryingCheckoutSuccess?: () => void
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

  async getRebaseStashMode(): Promise<TAutoStashMode | undefined> {
    const { mode } = this.configManager.get();

    if (mode === AUTO_STASH_MODE_BRANCH) {
      return AUTO_STASH_CURRENT_BRANCH;
    }

    if (mode === AUTO_STASH_MODE_POP || mode === AUTO_STASH_MODE_APPLY) {
      this.logService.info(`Stash mode '${mode}' is not applicable to rebase; using '${AUTO_STASH_CURRENT_BRANCH}' instead.`);
      return AUTO_STASH_CURRENT_BRANCH;
    }

    if (mode !== AUTO_STASH_MODE_MANUAL) {
      return;
    }

    const items: QuickPickItem[] = [
      {
        label: AUTO_STASH_CURRENT_BRANCH,
        detail: 'Stash changes, run rebase, then pop the stash on the same branch.',
      },
      {
        label: AUTO_STASH_IGNORE,
        detail: DESC_AUTO_STASH_IGNORE,
      },
    ];

    const picked = await showQuickPick(items, { placeHolder: 'Select auto stash mode for rebase' });

    this.logService.info(`Selected rebase mode: ${picked?.label}`);

    return picked?.label as TAutoStashMode;
  }

  async pullAndStashChanges(
    git: GitExecutor,
    currentBranch: string,
    strategy: TPullWithStashStrategy = 'merge'
  ): Promise<void> {
    const event = strategy === 'rebase'
      ? AnalyticsEvent.PullRebaseWithStash
      : AnalyticsEvent.PullWithStash;
    const stashMessage = getStashMessage(currentBranch, true);

    if (!(await git.hasUpstreamBranch(currentBranch))) {
      throw new Error(
        `Branch "${currentBranch}" has no upstream branch to pull from. Publish the branch first (git push -u origin ${currentBranch}).`
      );
    }

    const isWorkdirHasChangesBeforeStash = await git.isWorkdirHasChanges();

    if (isWorkdirHasChangesBeforeStash) {
      await git.createStash(stashMessage);
    }

    try {
      await git.pullFromRemoteBranch({ rebase: strategy === 'rebase' });
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      const operation = strategy === 'rebase' ? 'Pull with rebase' : 'Pull';

      if (isWorkdirHasChangesBeforeStash) {
        const isWorkdirHasChangesAfterFailedPull = await git.isWorkdirHasChanges();
        if (!isWorkdirHasChangesAfterFailedPull) {
          // Nothing partially merged/rebased - safe to restore the user's changes.
          await git.popStash(stashMessage);
          throw new Error(`${operation} failed: ${msg}`);
        }
      }

      throw new Error(`${operation} failed: ${msg}${isWorkdirHasChangesBeforeStash ? '\n\nYour changes are preserved in the stash.' : ''}`);
    }

    if (isWorkdirHasChangesBeforeStash) {
      const isWorkdirHasChanges = await git.isWorkdirHasChanges();
      if (isWorkdirHasChanges) {
        await git.resetLocalChanges();
      }

      await git.popStash(stashMessage);
    }

    capture(event, { had_changes: isWorkdirHasChangesBeforeStash });
  }

  async rebaseAndStashChanges(
    git: GitExecutor,
    currentBranch: string,
    targetRef: string,
    mode: TAutoStashMode,
    vscodeGitProvider?: VscodeGitProvider
  ): Promise<void> {
    const isWorkdirHasChanges = await git.isWorkdirHasChanges();

    if (mode === AUTO_STASH_IGNORE) {
      await this.#doRebase(git, targetRef, vscodeGitProvider);
      capture(AnalyticsEvent.RebaseWithStash, { stash_mode: mode, had_changes: isWorkdirHasChanges });
      return;
    }

    // AUTO_STASH_CURRENT_BRANCH (and any other mode treated as such)
    const stashMessage = getStashMessage(currentBranch, true);

    if (isWorkdirHasChanges) {
      await git.createStash(stashMessage);
    }

    try {
      await this.#doRebase(git, targetRef, vscodeGitProvider);
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      // Leave the stash intact so the user can recover after resolving rebase conflicts.
      throw new Error(`Rebase failed: ${msg}${isWorkdirHasChanges ? '\n\nYour changes are preserved in the stash.' : ''}`);
    }

    if (isWorkdirHasChanges) {
      const hasChangesAfterRebase = await git.isWorkdirHasChanges();
      if (hasChangesAfterRebase) {
        await git.resetLocalChanges();
      }
      await git.popStash(stashMessage);
    }

    capture(AnalyticsEvent.RebaseWithStash, { stash_mode: mode, had_changes: isWorkdirHasChanges });
  }

  /**
   * After a checkout, optionally pull the upstream of the given branch
   * according to the `pullAfterCheckout` setting:
   * - 'off': never pull.
   * - 'ffOnly': fast-forward only; never creates a merge commit. On failure
   *   (e.g. the branches have diverged), show a non-fatal warning instead of
   *   aborting the checkout.
   * - 'pull': full pull (today's default behavior before this setting existed).
   */
  async #maybePullAfterCheckout(git: GitExecutor, branch: string): Promise<void> {
    const { pullAfterCheckout } = this.configManager.get();

    if (pullAfterCheckout === PULL_AFTER_CHECKOUT_OFF) {
      return;
    }

    if (!(await git.hasUpstreamBranch(branch))) {
      return;
    }

    if (pullAfterCheckout === PULL_AFTER_CHECKOUT_PULL) {
      await git.pullCurrentBranch();
      return;
    }

    // PULL_AFTER_CHECKOUT_FF_ONLY (default)
    try {
      await git.pullCurrentBranchFfOnly();
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      await window.showWarningMessage(
        `Checked out '${branch}', but could not fast-forward to its upstream: ${msg}`
      );
    }
  }

  async #doRebase(git: GitExecutor, targetRef: string, vscodeGitProvider?: VscodeGitProvider): Promise<void> {
    if (vscodeGitProvider) {
      const used = await vscodeGitProvider.rebase(git.repositoryPath, targetRef);
      if (used) {
        return;
      }
    }
    await git.rebase(targetRef);
  }

  async checkoutAndStashChanges(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: IGitRef,
    autoStashMode: TAutoStashMode = AUTO_STASH_CURRENT_BRANCH
  ): Promise<CheckoutOutcome> {
    const nextBranchName = nextBranch.name;
    const previewRef = nextBranch.remote ? nextBranch.fullName : nextBranch.name;
    // `nextBranch.remote` reflects the remote the ref actually came from (e.g.
    // 'upstream' for a fork-setup branch that only exists there); passing it
    // through keeps checkout from assuming 'origin' when the branch lives on
    // a different remote.
    const remoteName = nextBranch.remote;
    const isWorkdirHasChanges = await git.isWorkdirHasChanges();
    let outcome: CheckoutOutcome = 'completed';
    switch (autoStashMode) {
      case AUTO_STASH_CURRENT_BRANCH:
        outcome = await this.doAutoStashCurrentBranch(git, currentBranch, nextBranchName, isWorkdirHasChanges, remoteName);
        break;
      case AUTO_STASH_AND_POP_IN_NEW_BRANCH:
        outcome = await this.doAutoStashAndPopInNewBranch(
          git,
          currentBranch,
          nextBranchName,
          isWorkdirHasChanges,
          false,
          previewRef,
          remoteName
        );
        break;
      case AUTO_STASH_AND_APPLY_IN_NEW_BRANCH:
        outcome = await this.doAutoStashAndPopInNewBranch(
          git,
          currentBranch,
          nextBranchName,
          isWorkdirHasChanges,
          true,
          previewRef,
          remoteName
        );
        break;
      case AUTO_STASH_IGNORE:
      default:
        try {
          await git.checkout(nextBranchName, remoteName);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to checkout the selected branch: ${msg}`);
        }
        await this.#maybePullAfterCheckout(git, nextBranchName);
        break;
    }

    if (outcome === 'completed') {
      capture(AnalyticsEvent.CheckoutToBranch, { stash_mode: autoStashMode, had_changes: isWorkdirHasChanges });

      // A "stash-carrying" checkout is one where a stash was actually created and
      // cleanly popped/applied onto the target branch (AUTO_STASH_IGNORE never stashes;
      // a 'rescued' outcome had a pop/apply conflict, so it doesn't count as clean).
      if (isWorkdirHasChanges && autoStashMode !== AUTO_STASH_IGNORE) {
        this.onStashCarryingCheckoutSuccess?.();
      }
    } else if (outcome === 'rescued') {
      // Checkout happened, but the stash pop/apply conflicted and a rescue notification
      // was already shown in place of a generic error — tag instead of double-reporting success.
      capture(AnalyticsEvent.CheckoutToBranch, { stash_mode: autoStashMode, had_changes: isWorkdirHasChanges, stashConflict: true });
    }

    return outcome;
  }

  async doAutoStashCurrentBranch(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: string,
    isWorkdirHasChanges: boolean,
    remoteName?: string
  ): Promise<CheckoutOutcome> {
    try {
      if (isWorkdirHasChanges) {
        const stashMessage = getStashMessage(currentBranch);
        await git.createStash(stashMessage);
      }
    } catch (e) {
      handleErrorMessage(e, undefined, undefined, undefined, this.logService);
    }

    try {
      await git.checkout(nextBranch, remoteName);
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to checkout the selected branch: ${msg}`);
    }
    await this.#maybePullAfterCheckout(git, nextBranch);

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
      const conflicts = await git.getConflictedFiles();
      if (conflicts.length > 0) {
        await offerConflictRescue(git, conflicts, 'pop');
        return 'rescued';
      }
      handleErrorMessage(
        e,
        'No stash found',
        'No stash to pop on the new branch.',
        'Failed to pop the stash on the new branch.',
        this.logService
      );
    }

    return 'completed';
  }

  async #confirmStashConflicts(files: string[], operation: string): Promise<boolean> {
    const fileList = files.map(f => ` • ${f}`).join('\n');
    const message =
      `Switching branches will ${operation} a stash that conflicts with the target branch.\n\n` +
      `Conflicting files:\n${fileList}\n\n` +
      `This preview covers tracked files only; untracked files may still conflict.\n\n` +
      `Continue anyway? You will need to resolve conflicts manually after checkout.`;
    const choice = await window.showWarningMessage(message, { modal: true }, 'Continue');
    return choice === 'Continue';
  }

  async doAutoStashAndPopInNewBranch(
    git: GitExecutor,
    currentBranch: string,
    nextBranch: string,
    isWorkdirHasChanges: boolean,
    apply: boolean = false,
    previewRef: string = nextBranch,
    remoteName?: string
  ): Promise<CheckoutOutcome> {
    const stashMessage = getStashMessage(currentBranch, true);
    const operation = apply ? 'apply' : 'pop';

    try {
      if (isWorkdirHasChanges) {
        const conflicts = await git.getStashConflictPreview(previewRef);
        if (conflicts.length > 0) {
          const proceed = await this.#confirmStashConflicts(conflicts, operation);
          if (!proceed) {
            this.logService.info('User cancelled checkout due to predicted stash conflicts');
            return 'cancelled';
          }
        }
        await git.createStash(stashMessage);
      }
    } catch (e) {
      handleErrorMessage(e, undefined, undefined, undefined, this.logService);
    }

    try {
      await git.checkout(nextBranch, remoteName);
    } catch (e) {
      captureException(e);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to checkout the selected branch: ${msg}`);
    }
    await this.#maybePullAfterCheckout(git, nextBranch);

    // nothing to pop if no changes were stashed before checkout
    if (!isWorkdirHasChanges) {
      return 'completed';
    }

    // Pop or apply the stash on the new branch
    try {
      const isStashWithMessageExists = await git.isStashWithMessageExists(stashMessage);
      if (isStashWithMessageExists) {
        await git.popStash(stashMessage, apply);
      }
    } catch (e) {
      const conflicts = await git.getConflictedFiles();
      if (conflicts.length > 0) {
        // Replace the generic error with the rescue notification — checkout already
        // happened and the stash was already applied/popped (with conflict markers left
        // in the working tree), so surfacing a second generic failure would be misleading.
        await offerConflictRescue(git, conflicts, operation);
        return 'rescued';
      }
      handleErrorMessage(e, 'No stash found', `No stash to ${operation} on the new branch.`, `Failed to ${operation} the stash on the new branch.`);
    }

    return 'completed';
  }
}
