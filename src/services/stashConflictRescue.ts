import * as path from 'path';
import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';

export type StashOperation = 'pop' | 'apply';

export async function offerConflictRescue(
  git: GitExecutor,
  files: string[],
  operation: StashOperation
): Promise<void> {
  // A conflicted pop/apply does not itself start a merge/cherry-pick operation tracked by
  // MERGE_HEAD/CHERRY_PICK_HEAD, but `git reset --merge` is only safe to offer when no other
  // merge-like operation (e.g. an in-progress rebase/cherry-pick/merge) is layered on top of it.
  const canUndo = !(await git.isMergeInProgress()) && !(await git.isCherryPickInProgress());
  const message = `Stash restored with conflicts: ${files.length} file(s) need resolution. ${
    operation === 'pop' ? 'The stash was preserved because pop conflicted.' : 'The stash is preserved because apply never removes it.'
  }`;
  const actions = ['Resolve conflicts', 'Open files', ...(canUndo ? ['Undo (keep stash)'] : [])];
  const choice = await vscode.window.showWarningMessage(message, ...actions);
  if (choice === 'Resolve conflicts') {
    await vscode.commands.executeCommand('workbench.view.scm');
    const uri = vscode.Uri.file(path.resolve(git.repositoryPath, files[0]));
    try {
      await vscode.commands.executeCommand('git.openMergeEditor', uri);
    } catch {
      try {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'mergeEditor.input');
      } catch {
        await vscode.commands.executeCommand('vscode.open', uri);
      }
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
