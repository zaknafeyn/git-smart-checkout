import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
