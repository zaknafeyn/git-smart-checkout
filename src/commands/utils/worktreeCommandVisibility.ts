import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { getWorkspaceFoldersFormatted } from '../../common/vscode';
import { LoggingService } from '../../logging/loggingService';
import { setContextHasMultipleRemovableWorktrees } from '../../utils/setContext';
import { getRemovableWorktrees } from './worktreeRemoval';

/**
 * Recomputes the `git-smart-checkout.hasMultipleRemovableWorktrees` context key
 * that gates the "Remove Multiple Worktrees..." command in the Command Palette.
 *
 * The check runs across every workspace folder without prompting (so it cannot
 * use {@link getGitExecutor}, which pops a repository picker on multi-folder
 * workspaces). The command is shown when any folder has at least two removable
 * worktrees. This is best-effort: the command re-validates at execution time.
 */
export async function refreshRemoveMultipleWorktreesVisibility(
  logService: LoggingService,
  vscodeGitProvider?: VscodeGitProvider
): Promise<void> {
  try {
    const folders = getWorkspaceFoldersFormatted() ?? [];

    for (const folder of folders) {
      const git = new GitExecutor(folder.path, logService, vscodeGitProvider);
      const worktrees = await git.worktreeListDetailed(true);

      if (getRemovableWorktrees(worktrees).length >= 2) {
        await setContextHasMultipleRemovableWorktrees(true);
        return;
      }
    }

    await setContextHasMultipleRemovableWorktrees(false);
  } catch (error) {
    logService.warn(
      `[Remove Multiple Worktrees] Failed to refresh command visibility: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
