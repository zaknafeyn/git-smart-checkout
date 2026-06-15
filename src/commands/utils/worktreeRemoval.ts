import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { IGitWorktree } from '../../common/git/types';
import { getStashMessage } from './getStashMessage';

export async function removeWorkspaceFoldersForPath(removedPath: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const indexesToRemove = folders
    .map((folder, index) => ({ folder, index }))
    .filter(({ folder }) => isSameOrChildPath(folder.uri.fsPath, removedPath))
    .map(({ index }) => index)
    .sort((a, b) => b - a);

  for (const index of indexesToRemove) {
    vscode.workspace.updateWorkspaceFolders(index, 1);
  }
}

export function isSameOrChildPath(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(
    normalizePathForComparison(parentPath),
    normalizePathForComparison(candidatePath)
  );
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizePathForComparison(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    try {
      return path.join(
        fs.realpathSync.native(path.dirname(targetPath)),
        path.basename(targetPath)
      );
    } catch {
      return path.resolve(targetPath);
    }
  }
}

export function getWorktreeBranchName(branchRef: string | undefined): string | undefined {
  return branchRef?.replace(/^refs\/heads\//, '');
}

/**
 * Worktrees a user is allowed to remove: every linked worktree except the main
 * one (always the first entry), excluding bare and prunable entries.
 */
export function getRemovableWorktrees(worktrees: IGitWorktree[]): IGitWorktree[] {
  return worktrees.slice(1).filter((worktree) => !worktree.bare && !worktree.prunable);
}

export function getWorktreeShortHead(worktree: IGitWorktree): string {
  return worktree.head?.slice(0, 7) ?? 'unknown';
}

export function getWorktreeLabel(worktree: IGitWorktree): string {
  const branchName = getWorktreeBranchName(worktree.branch);

  if (branchName) {
    return branchName;
  }

  if (worktree.detached) {
    return `Detached at ${getWorktreeShortHead(worktree)}`;
  }

  return path.basename(worktree.path);
}

export function getWorktreeDetail(worktree: IGitWorktree): string {
  if (worktree.detached) {
    return `Detached HEAD ${getWorktreeShortHead(worktree)}`;
  }

  return worktree.head ? `HEAD ${getWorktreeShortHead(worktree)}` : '';
}

export function getWorktreeStashName(worktree: IGitWorktree): string {
  return getStashMessage(
    getWorktreeBranchName(worktree.branch) ??
      `detached-${worktree.head ? getWorktreeShortHead(worktree) : path.basename(worktree.path)}`
  );
}
