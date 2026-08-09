import * as vscode from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { IGitStash } from '../common/git/types';
import { AUTO_STASH_PREFIX } from '../commands/checkoutToCommand/constants';
import { offerConflictRescue, StashOperation } from './stashConflictRescue';

export interface GroupedStashes {
  autoStashes: IGitStash[];
  otherStashes: IGitStash[];
}

/** True when `stash` was created by `AutoStashService` (message starts with `auto-stash-`). */
export function isAutoStash(stash: IGitStash): boolean {
  return stash.message.startsWith(`${AUTO_STASH_PREFIX}-`);
}

/**
 * Splits every stash (not just auto-stashes) into the "Auto-stashes" and
 * "Other stashes" groups the Stashes tree renders as top-level nodes.
 */
export function groupStashes(stashes: IGitStash[]): GroupedStashes {
  const autoStashes: IGitStash[] = [];
  const otherStashes: IGitStash[] = [];
  for (const stash of stashes) {
    (isAutoStash(stash) ? autoStashes : otherStashes).push(stash);
  }
  return { autoStashes, otherStashes };
}

/**
 * True when `stash` is older than `staleAfterDays`. A `staleAfterDays` of 0
 * (or below) disables staleness entirely (`git-smart-checkout.stashes.staleAfterDays`).
 */
export function isStashStale(stash: IGitStash, staleAfterDays: number, now: number = Date.now()): boolean {
  if (!staleAfterDays || staleAfterDays <= 0) {
    return false;
  }
  const ageMs = now - stash.timestamp * 1000;
  return ageMs > staleAfterDays * 24 * 60 * 60 * 1000;
}

/** Confirmation copy for dropping one or more stashes in a single modal. */
export function formatDropConfirmation(stashes: IGitStash[]): string {
  if (stashes.length === 1) {
    const stash = stashes[0];
    return `Permanently drop the stash for "${stash.sourceBranch ?? stash.message}"?`;
  }
  const branches = stashes.map((stash) => stash.sourceBranch ?? stash.message).join(', ');
  return `Permanently drop ${stashes.length} stashes (${branches})?`;
}

export type StashDiffSide = 'before' | 'after';

/**
 * Resolves file content for one side of a per-file stash diff.
 * - 'before': the pre-stash state, `<hash>^:<path>`. Missing at that revision means the file
 *   didn't exist before the stash (added by it) — rendered as an empty side.
 * - 'after': the stashed state. Tracked changes live in the stash commit itself, `<hash>:<path>`.
 *   Untracked files captured by the stash live only in its third parent (the "untracked files"
 *   commit `git stash` creates), `<hash>^3:<path>` — tried as a fallback when the primary lookup
 *   doesn't find the file.
 */
export async function getStashFileContent(
  git: Pick<GitExecutor, 'getFileAtRev'>,
  hash: string,
  filePath: string,
  side: StashDiffSide
): Promise<string> {
  if (side === 'before') {
    return (await git.getFileAtRev(`${hash}^`, filePath)) ?? '';
  }

  const tracked = await git.getFileAtRev(hash, filePath);
  if (tracked !== undefined) {
    return tracked;
  }

  const untracked = await git.getFileAtRev(`${hash}^3`, filePath);
  return untracked ?? '';
}

/** Warns about uncommitted changes before an apply/pop that could conflict with them. */
export async function confirmDirtyWorktree(action: 'apply' | 'pop'): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `The current worktree has uncommitted changes. ${action === 'apply' ? 'Apply' : 'Pop'} this stash anyway?`,
    { modal: true },
    'Continue',
    'Cancel'
  );
  return choice === 'Continue';
}

/** Single modal confirming drop of one or more stashes (never one dialog per stash). */
export async function confirmDropStashes(stashes: IGitStash[]): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    formatDropConfirmation(stashes),
    { modal: true },
    'Drop',
    'Cancel'
  );
  return choice === 'Drop';
}

/**
 * Business logic shared by the Stashes tree view and `ManageAutoStashesCommand`: hash-verified
 * selectors (via `GitExecutor.resolveStashSelector`, so a stale positional `stash@{N}` never acts
 * on the wrong entry), conflict-rescue on apply/pop, and a single `onDidChangeStashes` event fired
 * after every mutation — shared with `AutoStashService`, whose checkout-time stash creates/pops
 * also notify through it — so the Stashes tree (and the auto-stash badge) refresh without polling.
 */
export class StashService {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStashes = this.changeEmitter.event;

  /** Notifies listeners that stash state changed. Called by this service and by `AutoStashService`. */
  notifyChanged(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  async listStashes(git: GitExecutor): Promise<IGitStash[]> {
    return git.listStashes();
  }

  async applyStash(git: GitExecutor, stash: IGitStash): Promise<'applied' | 'rescued'> {
    return (await this.applyOrPop(git, stash, 'apply')) as 'applied' | 'rescued';
  }

  async popStash(git: GitExecutor, stash: IGitStash): Promise<'popped' | 'rescued'> {
    return (await this.applyOrPop(git, stash, 'pop')) as 'popped' | 'rescued';
  }

  private async applyOrPop(
    git: GitExecutor,
    stash: IGitStash,
    operation: StashOperation
  ): Promise<'applied' | 'popped' | 'rescued'> {
    const selector = await git.resolveStashSelector(stash.selector, stash.hash);
    try {
      if (operation === 'apply') {
        await git.applyStash(selector);
      } else {
        await git.popStashBySelector(selector);
      }
    } catch (error) {
      const conflicts = await git.getConflictedFiles();
      if (conflicts.length === 0) {
        throw error;
      }
      await offerConflictRescue(git, conflicts, operation);
      this.notifyChanged();
      return 'rescued';
    }
    this.notifyChanged();
    return operation === 'apply' ? 'applied' : 'popped';
  }

  async dropStash(git: GitExecutor, stash: IGitStash): Promise<void> {
    await this.dropStashes(git, [stash]);
  }

  /**
   * Drops several stashes from one confirmation. Each selector is re-resolved by hash
   * immediately before its own drop — `stash@{N}` indices shift after every removal, so reusing
   * selectors captured before the loop started could drop the wrong entry.
   */
  async dropStashes(git: GitExecutor, stashes: IGitStash[]): Promise<void> {
    for (const stash of stashes) {
      const selector = await git.resolveStashSelector(stash.selector, stash.hash);
      await git.dropStash(selector);
    }
    this.notifyChanged();
  }

  async createBranchFromStash(git: GitExecutor, stash: IGitStash, branchName: string): Promise<void> {
    const selector = await git.resolveStashSelector(stash.selector, stash.hash);
    await git.createBranchFromStash(branchName, selector);
    this.notifyChanged();
  }

  async getStashPatch(git: GitExecutor, stash: IGitStash): Promise<string> {
    const selector = await git.resolveStashSelector(stash.selector, stash.hash);
    return git.getStashPatch(selector);
  }
}
