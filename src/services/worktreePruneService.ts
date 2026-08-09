import { getRemovableWorktrees, getWorktreeBranchName, getWorktreeLabel } from '../commands/utils/worktreeRemoval';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitRef, IGitWorktree } from '../common/git/types';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';

/** A prunable worktree together with the branch it holds and its uncommitted files. */
export interface PrunableWorktree {
  worktree: IGitWorktree;
  branch: string;
  dirtyFiles: string[];
}

/** How many dirty file names are listed per worktree before the list is elided. */
export const MAX_DIRTY_FILES_SHOWN = 10;

/**
 * Worktrees whose branch is dead: the branch still exists locally but its
 * upstream is gone, i.e. the remote branch was deleted (typically after the PR
 * merged). This is the same signal the Worktrees view renders as
 * "⚑ upstream gone".
 *
 * The main worktree, bare and already-prunable entries are never candidates
 * (see {@link getRemovableWorktrees}), and neither are detached-HEAD worktrees,
 * which have no branch to check or delete.
 */
export function findPrunableWorktrees(worktrees: IGitWorktree[], refs: IGitRef[]): IGitWorktree[] {
  const goneBranches = new Set(
    refs
      .filter((ref) => !ref.remote && !ref.isTag && ref.parsedUpstreamTrack === 'gone')
      .map((ref) => ref.name)
  );

  return getRemovableWorktrees(worktrees).filter((worktree) => {
    if (worktree.detached) {
      return false;
    }
    const branch = getWorktreeBranchName(worktree.branch);
    return Boolean(branch && goneBranches.has(branch));
  });
}

/**
 * Resolves the prune candidates for `git`'s repository and reads each one's
 * uncommitted files. The ref list is fetched **once per repository** — the
 * per-worktree status calls are the only fan-out.
 *
 * A worktree whose status cannot be read is reported as clean; `git worktree
 * remove` (run without `--force`) then refuses it rather than discarding work.
 */
export async function collectPrunableWorktrees(
  git: GitExecutor,
  logService: LoggingService,
  vscodeGitProvider?: VscodeGitProvider
): Promise<PrunableWorktree[]> {
  const [worktrees, refs] = await Promise.all([
    git.worktreeListDetailed(),
    git.getAllRefListExtended(),
  ]);

  return Promise.all(
    findPrunableWorktrees(worktrees, refs).map(async (worktree) => {
      const worktreeGit = new GitExecutor(worktree.path, logService, vscodeGitProvider);
      let dirtyFiles: string[] = [];

      try {
        dirtyFiles = await worktreeGit.listDirtyFiles();
      } catch (error) {
        logService.warn(
          `[Prune Worktrees] Failed to read status of ${worktree.path}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      return {
        worktree,
        branch: getWorktreeBranchName(worktree.branch) as string,
        dirtyFiles,
      };
    })
  );
}

/**
 * Body of the prune confirmation dialog: one bullet per worktree, with the
 * uncommitted file names spelled out (capped at {@link MAX_DIRTY_FILES_SHOWN})
 * so the user can see exactly what is about to be stashed or discarded.
 */
export function formatPruneConfirmationDetail(candidates: PrunableWorktree[]): string {
  return candidates
    .map(({ worktree, dirtyFiles }) => {
      const lines = [`• ${getWorktreeLabel(worktree)} (${worktree.path})`];

      if (dirtyFiles.length > 0) {
        lines.push(
          `    ${dirtyFiles.length} uncommitted file${dirtyFiles.length === 1 ? '' : 's'}:`
        );
        for (const file of dirtyFiles.slice(0, MAX_DIRTY_FILES_SHOWN)) {
          lines.push(`      - ${file}`);
        }
        const remaining = dirtyFiles.length - MAX_DIRTY_FILES_SHOWN;
        if (remaining > 0) {
          lines.push(`      …and ${remaining} more`);
        }
      }

      return lines.join('\n');
    })
    .join('\n');
}
