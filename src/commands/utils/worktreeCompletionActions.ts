import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const ACTION_ADD_TO_WORKSPACE = 'Add to Workspace';
export const ACTION_OPEN_FOLDER = 'Open in Current Window';
export const ACTION_OPEN_IN_NEW_WINDOW = 'Open in New Window';

export async function showWorktreeCompletionActions(
  worktreePath: string,
  message: string
): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    message,
    ...getWorktreeCompletionActions(worktreePath)
  );

  switch (action) {
    case ACTION_ADD_TO_WORKSPACE:
      addToWorkspace(worktreePath);
      break;
    case ACTION_OPEN_FOLDER:
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), false);
      break;
    case ACTION_OPEN_IN_NEW_WINDOW:
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
      break;
  }
}

export function getWorktreeCompletionActions(worktreePath: string): string[] {
  const actions = [ACTION_OPEN_FOLDER, ACTION_OPEN_IN_NEW_WINDOW];

  if (!isWorktreeInWorkspace(worktreePath)) {
    actions.unshift(ACTION_ADD_TO_WORKSPACE);
  }

  return actions;
}

function addToWorkspace(worktreePath: string): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  vscode.workspace.updateWorkspaceFolders(folders.length, null, {
    uri: vscode.Uri.file(worktreePath),
    name: path.basename(worktreePath),
  });
}

function isWorktreeInWorkspace(worktreePath: string): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some((folder) =>
    isSamePath(folder.uri.fsPath, worktreePath)
  );
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function normalizePathForComparison(targetPath: string): string {
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
