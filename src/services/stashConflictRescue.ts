import * as path from 'path';
import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';

export type StashOperation = 'pop' | 'apply';

export async function offerConflictRescue(
  git: GitExecutor,
  files: string[],
  operation: StashOperation
): Promise<void> {
  const canUndo = !(await git.isMergeInProgress());
  const message = `Stash restored with conflicts: ${files.length} file(s) need resolution. ${
    operation === 'pop' ? 'The stash was preserved because pop conflicted.' : 'The stash is preserved because apply never removes it.'
  }`;
  const actions = ['Resolve conflicts', 'Open files', ...(canUndo ? ['Undo (keep stash)'] : [])];
  const choice = await vscode.window.showWarningMessage(message, ...actions);
  if (choice === 'Resolve conflicts') {
    await vscode.commands.executeCommand('workbench.view.scm');
    const uri = vscode.Uri.file(path.resolve(git.repositoryPath, files[0]));
    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, 'workbench.editors.textFileEditor');
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  } else if (choice === 'Open files') {
    await Promise.all(files.map((file) => vscode.commands.executeCommand(
      'vscode.open', vscode.Uri.file(path.resolve(git.repositoryPath, file))
    )));
  } else if (choice === 'Undo (keep stash)') {
    await git.resetMerge();
    await vscode.window.showInformationMessage(
      'Conflicted changes were undone. The stash is preserved in GSC: Manage auto-stashes...'
    );
  }
}
