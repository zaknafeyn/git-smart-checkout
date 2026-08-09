import * as vscode from 'vscode';
import { GitHubClient, resolveGitHubHostConfig } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';
import {
  buildCleanupQuickPickItems,
  buildConfirmDeletionMessage,
  buildRecoveryDocument,
  computeCleanupCandidates,
  ICleanupDeletionResult,
  IPrMergeInfo,
  summarizeDeletions,
  toSelectedCandidates,
} from './candidates';

const UNDO_HINT_ACTION = 'Undo hint';

export class CleanupBranchesCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService,
    private readonly provider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor(this.provider, 'Delete merged branches');
    const current = await git.getCurrentBranch();

    let base: string;
    try {
      base = await git.getDefaultBranch();
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Could not determine the default branch: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const mergedNames = new Set(await git.getMergedBranches(base));
    const worktreeBranches = new Set(
      (await git.worktreeListDetailed(true))
        .map((worktree) => worktree.branch?.replace(/^refs\/heads\//, ''))
        .filter((name): name is string => !!name)
    );
    const localRefs = (await git.getAllRefListExtended()).filter((ref) => !ref.remote && !ref.isTag);

    const { squashMergedNames, prMergeInfo } = await this.detectSquashMerges(
      git,
      base,
      localRefs.filter((ref) => ref.name !== current && ref.name !== base && !worktreeBranches.has(ref.name)),
      mergedNames
    );

    const candidates = computeCleanupCandidates(
      localRefs,
      mergedNames,
      worktreeBranches,
      current,
      base,
      squashMergedNames,
      prMergeInfo
    );

    if (candidates.length === 0) {
      await vscode.window.showInformationMessage('No merged or orphaned branches to clean up.', 'OK');
      return;
    }

    const items = buildCleanupQuickPickItems(candidates, base);
    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: `Delete merged branches (base: ${base})`,
    });
    const selectedCandidates = toSelectedCandidates(selected);
    if (selectedCandidates.length === 0) return;

    const confirmed = await vscode.window.showWarningMessage(
      buildConfirmDeletionMessage(selectedCandidates),
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') return;

    const results: ICleanupDeletionResult[] = [];
    for (const candidate of selectedCandidates) {
      const { ref, group } = candidate;
      try {
        // Tip SHA is captured up-front (before any deletion) via getAllRefListExtended.
        // Anything git's own ancestry check can't see as merged (gone-upstream, or
        // squash/rebase-merged) needs the force delete.
        await git.deleteBranch(ref.name, group !== 'merged');
        results.push({ name: ref.name, sha: ref.hash ?? '', success: true });
      } catch (error) {
        this.logService.warn(`Failed to delete ${ref.name}: ${error}`);
        results.push({ name: ref.name, sha: ref.hash ?? '', success: false });
      }
    }

    const summary = summarizeDeletions(results);
    const action = await vscode.window.showInformationMessage(summary, UNDO_HINT_ACTION);
    if (action === UNDO_HINT_ACTION) {
      const document = await vscode.workspace.openTextDocument({
        content: buildRecoveryDocument(results),
        language: 'shellscript',
      });
      await vscode.window.showTextDocument(document);
    }
  }

  /**
   * Detects branches `git branch --merged` can't see because the merge
   * rewrote history (squash or rebase merge): offline patch-equivalence
   * (always attempted, gated by `cleanupBranches.detectSquashMerged`) and
   * GitHub PR state (attempted only when the repo has a GitHub remote;
   * silently skipped otherwise — same fallback convention as `StackService`).
   *
   * `candidateRefs` should already exclude the current branch, the default
   * branch, worktree-checked-out branches, and (implicitly, via the caller's
   * ordering) branches already known ancestor-merged — this method re-checks
   * against `mergedNames` anyway as a cheap guard against double-reporting.
   */
  private async detectSquashMerges(
    git: GitExecutor,
    base: string,
    candidateRefs: { name: string; hash?: string }[],
    mergedNames: Set<string>
  ): Promise<{ squashMergedNames: Set<string>; prMergeInfo: Map<string, IPrMergeInfo> }> {
    const empty = { squashMergedNames: new Set<string>(), prMergeInfo: new Map<string, IPrMergeInfo>() };
    const config = this.configManager.get();
    if (!config.cleanupBranches.detectSquashMerged) {
      return empty;
    }

    const unmergedRefs = candidateRefs.filter((ref) => !mergedNames.has(ref.name));
    if (unmergedRefs.length === 0) {
      return empty;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Git Smart Checkout: Detecting squash-merged branches...',
        cancellable: false,
      },
      async (progress) => {
        const squashMergedNames = new Set<string>();
        for (const ref of unmergedRefs) {
          progress.report({ message: ref.name });
          try {
            if (await git.isSquashMerged(base, ref.name)) {
              squashMergedNames.add(ref.name);
            }
          } catch (error) {
            this.logService.warn(`Squash-merge detection failed for ${ref.name}: ${error}`);
          }
        }

        const prMergeInfo = await this.fetchPrMergeInfo(git, unmergedRefs);
        return { squashMergedNames, prMergeInfo };
      }
    );
  }

  /** GitHub PR-based merge state, keyed by branch name. Empty when there's no GitHub remote or the API call fails. */
  private async fetchPrMergeInfo(
    git: GitExecutor,
    candidateRefs: { name: string; hash?: string }[]
  ): Promise<Map<string, IPrMergeInfo>> {
    const prMergeInfo = new Map<string, IPrMergeInfo>();
    const config = this.configManager.get();

    const repoInfo = await git.getRepoInfo(config.githubEnterpriseBaseUrl).catch(() => null);
    if (!repoInfo) {
      return prMergeInfo;
    }

    const ghClient = new GitHubClient(
      repoInfo.owner,
      repoInfo.repo,
      undefined,
      resolveGitHubHostConfig(repoInfo.host, config.githubEnterpriseBaseUrl)
    );

    let closedPrs;
    try {
      closedPrs = await ghClient.listClosedPullRequestsOrThrow();
    } catch (error) {
      this.logService.warn(`Cleanup branches: failed to fetch closed pull requests: ${error}`);
      return prMergeInfo;
    }

    const tipByBranch = new Map(candidateRefs.map((ref) => [ref.name, ref.hash]));
    for (const pr of closedPrs) {
      if (!pr.merged_at) {
        continue; // closed without merging
      }
      const tip = tipByBranch.get(pr.head.ref);
      if (!tip) {
        continue; // not a local branch we're considering
      }
      prMergeInfo.set(pr.head.ref, { prNumber: pr.number, diverged: tip !== pr.head.sha });
    }

    return prMergeInfo;
  }
}
