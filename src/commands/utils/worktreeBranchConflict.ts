import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';

export const WORKTREE_CONFLICT_OPEN_CURRENT = 'Open in Current Window';
export const WORKTREE_CONFLICT_OPEN_NEW = 'Open in New Window';
export const WORKTREE_CONFLICT_CREATE_BRANCH = 'Create New Branch...';

export type WorktreeBranchConflictResult =
  | { action: 'openCurrent' }
  | { action: 'openNew' }
  | { action: 'createBranch'; newBranchName: string }
  | { action: 'cancel' };

export async function findWorktreeForBranch(
  git: GitExecutor,
  branchName: string
): Promise<IGitWorktree | undefined> {
  const expectedRef = `refs/heads/${branchName}`;
  const worktrees = await git.worktreeListDetailed(true);
  // Skip the main worktree (the repo we're operating in) — it's not a conflict.
  return worktrees.find(
    (wt) =>
      !wt.bare &&
      !wt.prunable &&
      wt.branch === expectedRef &&
      wt.path !== git.repositoryPath
  );
}

export async function handleWorktreeBranchConflict(
  branchName: string,
  worktreePath: string
): Promise<WorktreeBranchConflictResult> {
  const chosen = await vscode.window.showInformationMessage(
    `Branch "${branchName}" is already checked out in another worktree at "${worktreePath}".`,
    WORKTREE_CONFLICT_OPEN_CURRENT,
    WORKTREE_CONFLICT_OPEN_NEW,
    WORKTREE_CONFLICT_CREATE_BRANCH
  );

  if (!chosen) {
    return { action: 'cancel' };
  }

  if (chosen === WORKTREE_CONFLICT_OPEN_CURRENT) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), false);
    return { action: 'openCurrent' };
  }

  if (chosen === WORKTREE_CONFLICT_OPEN_NEW) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
    return { action: 'openNew' };
  }

  const newBranchName = await vscode.window.showInputBox({
    placeHolder: 'Branch name',
    prompt: `Create new branch from "${branchName}"`,
  });

  if (!newBranchName) {
    return { action: 'cancel' };
  }

  return { action: 'createBranch', newBranchName };
}
