import { GitExecutor } from '../common/git/gitExecutor';
import { IGitWorktree } from '../common/git/types';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { getWorkspaceFoldersFormatted } from '../common/vscode';
import { getRemovableWorktrees, normalizePathForComparison } from '../commands/utils/worktreeRemoval';
import { LoggingService } from '../logging/loggingService';
import { PRReviewWorktreeStore } from '../services/prReviewWorktreeStore';

/**
 * Repository state used to decide which condition-dependent items appear in the
 * status-bar quick actions menu. Every flag mirrors the early-exit guard inside
 * the command it gates, so a shown item never immediately dead-ends in an
 * informational dialog.
 */
export interface WorktreeQuickActionsState {
  /** At least one removable (linked, non-bare, non-prunable) worktree exists. */
  hasRemovableWorktree: boolean;
  /** At least two removable worktrees exist. */
  hasMultipleRemovableWorktrees: boolean;
  /** At least one worktree other than the current one is selectable. */
  hasOtherWorktree: boolean;
  /** Staged changes exist and there is another worktree to copy them into. */
  canCopyStagedToWorktree: boolean;
  /** Working-tree (WIP) changes exist and there is another worktree to copy them into. */
  canCopyWipToWorktree: boolean;
  /** At least one tracked PR-review worktree still exists on disk. */
  hasPRReviewWorktree: boolean;
}

const EMPTY_STATE: WorktreeQuickActionsState = {
  hasRemovableWorktree: false,
  hasMultipleRemovableWorktrees: false,
  hasOtherWorktree: false,
  canCopyStagedToWorktree: false,
  canCopyWipToWorktree: false,
  hasPRReviewWorktree: false,
};

function isSamePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

/**
 * Worktrees other than the one rooted at {@link repositoryPath}, excluding bare
 * and prunable entries. Matches the `selectableWorktrees` filter used by the
 * copy/move-from-worktree commands.
 */
function getOtherWorktrees(worktrees: IGitWorktree[], repositoryPath: string): IGitWorktree[] {
  return worktrees.filter(
    (worktree) =>
      !worktree.bare && !worktree.prunable && !isSamePath(worktree.path, repositoryPath)
  );
}

async function gatherForFolder(
  folderPath: string,
  logService: LoggingService,
  store: PRReviewWorktreeStore,
  vscodeGitProvider?: VscodeGitProvider
): Promise<WorktreeQuickActionsState> {
  const git = new GitExecutor(folderPath, logService, vscodeGitProvider);
  const worktrees = await git.worktreeListDetailed(true);

  const removableCount = getRemovableWorktrees(worktrees).length;
  const hasOtherWorktree = getOtherWorktrees(worktrees, git.repositoryPath).length > 0;

  const hasStagedChanges = Boolean((await git.getStagedChangesPatch()).trim());
  const hasWipChanges = await git.isWorkdirHasChanges();

  const repoInfo = await git.getRepoInfo();
  const identity = {
    repoKey: PRReviewWorktreeStore.createRepoKey(repoInfo?.owner, repoInfo?.repo, git.repositoryPath),
    repositoryPath: git.repositoryPath,
  };
  const records = await store.getForRepository(identity);
  const hasPRReviewWorktree = records.some((record) =>
    worktrees.some((worktree) => isSamePath(worktree.path, record.worktreePath))
  );

  return {
    hasRemovableWorktree: removableCount >= 1,
    hasMultipleRemovableWorktrees: removableCount >= 2,
    hasOtherWorktree,
    // Source changes and the target worktree must live in the SAME folder, so
    // these are derived per-folder before the OR-combine below.
    canCopyStagedToWorktree: hasStagedChanges && hasOtherWorktree,
    canCopyWipToWorktree: hasWipChanges && hasOtherWorktree,
    hasPRReviewWorktree,
  };
}

/**
 * Computes {@link WorktreeQuickActionsState} across every workspace folder
 * without prompting (so it never uses `getGitExecutor`, which pops a repository
 * picker on multi-folder workspaces). Each flag is OR-combined across folders.
 *
 * Best-effort: any failure degrades to an all-false state so the menu still
 * opens with the always-available actions.
 */
export async function gatherWorktreeQuickActionsState(
  logService: LoggingService,
  store: PRReviewWorktreeStore,
  vscodeGitProvider?: VscodeGitProvider
): Promise<WorktreeQuickActionsState> {
  try {
    const folders = getWorkspaceFoldersFormatted() ?? [];
    const state: WorktreeQuickActionsState = { ...EMPTY_STATE };

    for (const folder of folders) {
      try {
        const folderState = await gatherForFolder(folder.path, logService, store, vscodeGitProvider);
        state.hasRemovableWorktree ||= folderState.hasRemovableWorktree;
        state.hasMultipleRemovableWorktrees ||= folderState.hasMultipleRemovableWorktrees;
        state.hasOtherWorktree ||= folderState.hasOtherWorktree;
        state.canCopyStagedToWorktree ||= folderState.canCopyStagedToWorktree;
        state.canCopyWipToWorktree ||= folderState.canCopyWipToWorktree;
        state.hasPRReviewWorktree ||= folderState.hasPRReviewWorktree;
      } catch (error) {
        logService.warn(
          `[Quick Actions] Failed to gather worktree state for ${folder.path}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return state;
  } catch (error) {
    logService.warn(
      `[Quick Actions] Failed to gather worktree state: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { ...EMPTY_STATE };
  }
}
