import * as path from 'path';
import * as vscode from 'vscode';

import { IGitWorktree } from '../../common/git/types';

import { getWorktreeBranchName, normalizePathForComparison } from './worktreeRemoval';

export interface WorktreeQuickPickItem extends vscode.QuickPickItem {
  worktreePath: string;
}

function getWorktreeLabel(worktree: IGitWorktree): string {
  const branchName = getWorktreeBranchName(worktree.branch);

  if (branchName) {
    return branchName;
  }

  if (worktree.detached) {
    return '(detached HEAD)';
  }

  if (worktree.bare) {
    return '(bare)';
  }

  return path.basename(worktree.path);
}

/**
 * Builds QuickPick items for the worktree terminal picker. The worktree whose
 * path matches `currentPath` is marked as `(current)` and sorted to the top.
 */
export function buildWorktreeTerminalItems(
  worktrees: IGitWorktree[],
  currentPath: string
): WorktreeQuickPickItem[] {
  const normalizedCurrent = normalizePathForComparison(currentPath);

  return worktrees
    .map((worktree) => {
      const isCurrent = normalizePathForComparison(worktree.path) === normalizedCurrent;
      const label = getWorktreeLabel(worktree);

      return {
        label: isCurrent ? `${label} (current)` : label,
        description: worktree.path,
        worktreePath: worktree.path,
        isCurrent,
      };
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
    .map(({ isCurrent, ...item }) => item);
}

/**
 * Derives a terminal name from a worktree, preferring the branch name and
 * falling back to the worktree directory basename.
 */
export function getWorktreeTerminalName(worktree: IGitWorktree): string {
  return getWorktreeBranchName(worktree.branch) ?? path.basename(worktree.path);
}
