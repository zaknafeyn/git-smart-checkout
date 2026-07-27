import * as vscode from 'vscode';

export interface ResolvedWorktreeArg {
  worktreePath: string;
  repositoryPath?: string;
}

/**
 * `view/item/context` (including `inline`) commands are invoked by VS Code with the tree
 * element itself as the first argument, not `TreeItem.command.arguments` (those only apply
 * to the row's default click command). Normalizes whatever shape shows up — a plain string,
 * a Uri, or a WorktreeTreeItem — into a path string.
 */
export function resolveWorktreeArg(arg: unknown, repositoryPath?: string): ResolvedWorktreeArg | undefined {
  if (typeof arg === 'string') {
    return arg ? { worktreePath: arg, repositoryPath } : undefined;
  }
  if (arg instanceof vscode.Uri) {
    return { worktreePath: arg.fsPath, repositoryPath };
  }
  if (isWorktreeTreeItemLike(arg)) {
    return { worktreePath: arg.worktree.path, repositoryPath: arg.repositoryPath ?? repositoryPath };
  }
  return undefined;
}

function isWorktreeTreeItemLike(
  arg: unknown
): arg is { worktree: { path: string }; repositoryPath?: string } {
  if (typeof arg !== 'object' || arg === null) {
    return false;
  }
  const candidate = arg as { worktree?: unknown; repositoryPath?: unknown };
  return (
    typeof candidate.worktree === 'object' &&
    candidate.worktree !== null &&
    typeof (candidate.worktree as { path?: unknown }).path === 'string' &&
    (candidate.repositoryPath === undefined || typeof candidate.repositoryPath === 'string')
  );
}
