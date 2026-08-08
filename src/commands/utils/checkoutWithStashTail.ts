import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { AutoStashService, CheckoutOutcome } from '../../services/autoStashService';
import { AUTO_STASH_IGNORE } from '../checkoutToCommand/constants';
import { TAutoStashMode } from '../checkoutToCommand/types';
import { findWorktreeForBranch, handleWorktreeBranchConflict } from './worktreeBranchConflict';

export type CheckoutTailOutcome = CheckoutOutcome | 'aborted' | 'worktreeConflict';

export interface CheckoutRefWithStashParams {
  git: GitExecutor;
  currentBranch: string;
  targetRef: IGitRef;
  autoStashService: AutoStashService;
}

export interface CheckoutRefWithStashResult {
  outcome: CheckoutTailOutcome;
  autoStashMode?: TAutoStashMode;
}

/**
 * Shared "post-selection" checkout tail: resolves a worktree conflict (with
 * an option to spin off a new branch instead), resolves the stash mode
 * (skipping the prompt entirely on a clean tree), then delegates to
 * `AutoStashService.checkoutAndStashChanges`. Previously duplicated across
 * `CheckoutToCommand`, `CheckoutPreviousCommand`, and `CheckoutByPRCommand`.
 */
export async function checkoutRefWithStash(
  params: CheckoutRefWithStashParams
): Promise<CheckoutRefWithStashResult> {
  const { git, currentBranch, targetRef, autoStashService } = params;

  const conflictWorktree = await findWorktreeForBranch(git, targetRef.name);
  if (conflictWorktree) {
    const result = await handleWorktreeBranchConflict(targetRef.fullName, conflictWorktree.path);
    if (result.action === 'createBranch') {
      try {
        await git.createBranch(result.newBranchName, targetRef.fullName);
        capture(AnalyticsEvent.BranchCreated);
      } catch (e) {
        captureException(e);
        const msg = e instanceof Error ? e.message : String(e);
        await vscode.window.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
      }
    }
    return { outcome: 'worktreeConflict' };
  }

  const isDirty = await git.isWorkdirHasChanges();
  const autoStashMode = isDirty ? await autoStashService.getAutoStashMode() : AUTO_STASH_IGNORE;
  if (!autoStashMode) {
    return { outcome: 'aborted' };
  }

  const outcome = await autoStashService.checkoutAndStashChanges(git, currentBranch, targetRef, autoStashMode);
  return { outcome, autoStashMode };
}
