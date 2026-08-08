import * as vscode from 'vscode';

import { GitHubClient, resolveGitHubHostConfig } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitRef } from '../common/git/types';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../configuration/configurationManager';
import {
  STACKS_DETECTION_AUTO,
  STACKS_DETECTION_GITHUB,
  STACKS_DETECTION_LOCAL,
  STACKS_DETECTION_MANUAL,
} from '../configuration/extensionConfig';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';
import { buildPrStack } from './prStack';
import { PrStackCache } from './prStackCache';
import { heuristicEntriesFrom, detectLocalAncestryStacks } from './stackDetectionService';
import { StackAheadBehind, StackView, stackViewFromForest, stackViewFromPrStack } from './stackModel';
import { StackStore } from './stackStore';
import { buildStackForest, findStackContaining } from './stackTopology';

export interface StackRefreshResult {
  view?: StackView;
  currentBranch?: string;
  isDetached: boolean;
}

/**
 * Orchestrates a stacks refresh: PR chains (GitHub) are authoritative and
 * consulted first; the local ancestry heuristic only runs as an offline
 * fallback when GitHub data is genuinely unusable (no GitHub remote, or the
 * API call failed with no fresh cache) — the two sources are never merged
 * into one view, unlike the tree-view-era `detectStacks`.
 *
 * Fetches the open-PR list at most once per repository per refresh (cached
 * in `PrStackCache`), shared by both the Stacks webview and the status bar
 * indicator, instead of once per branch.
 */
export class StackService {
  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly logService: LoggingService,
    private readonly cache: PrStackCache,
    private readonly stackStore: StackStore,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {}

  /** Refreshes across all workspace folders; the first folder with a stack wins. */
  async refresh(): Promise<StackRefreshResult> {
    const config = this.configManager.get();
    if (!config.stacks.enabled) {
      return { isDetached: false };
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    let fallback: StackRefreshResult | undefined;

    for (const folder of folders) {
      try {
        const repositoryPath = await resolveGitRepositoryRoot(folder.uri.fsPath, this.logService);
        const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
        const result = await this.refreshForRepo(git);
        if (result.view) {
          return result;
        }
        fallback ??= result;
      } catch (error) {
        this.logService.warn(`Stack refresh failed for ${folder.uri.fsPath}: ${error}`);
      }
    }

    return fallback ?? { isDetached: false };
  }

  async refreshForRepo(git: GitExecutor): Promise<StackRefreshResult> {
    const currentBranch = await git.getCurrentBranch().catch(() => undefined);
    if (!currentBranch) {
      return { isDetached: true };
    }

    const config = this.configManager.get();
    const mode = config.stacks.detection;
    if (mode === STACKS_DETECTION_MANUAL) {
      return { currentBranch, isDetached: false };
    }

    const trunk = await git.getDefaultBranch().catch(() => undefined);
    const useGithub = mode === STACKS_DETECTION_AUTO || mode === STACKS_DETECTION_GITHUB;
    const useLocal = mode === STACKS_DETECTION_AUTO || mode === STACKS_DETECTION_LOCAL;

    if (useGithub) {
      const prs = await this.fetchPrs(git, config.githubEnterpriseBaseUrl);
      if (prs !== undefined) {
        // GitHub data is authoritative once available — never fall back to
        // the heuristic just because this branch isn't part of a PR chain.
        const stack = buildPrStack(prs, currentBranch, { trunk });
        const view = stack
          ? stackViewFromPrStack(
              stack,
              currentBranch,
              git.repositoryPath,
              await this.aheadBehindFor(git, stack.target)
            )
          : undefined;
        return { view, currentBranch, isDetached: false };
      }
    }

    if (useLocal && trunk) {
      const view = await this.heuristicView(git, trunk, currentBranch);
      return { view, currentBranch, isDetached: false };
    }

    return { currentBranch, isDetached: false };
  }

  /**
   * Fetches the open-PR list for `git`'s repository, exactly once. Returns
   * `undefined` when GitHub data cannot be used at all: not a GitHub repo,
   * or the API call failed and no fresh cached list is available.
   */
  private async fetchPrs(git: GitExecutor, enterpriseBaseUrl: string): Promise<GitHubPR[] | undefined> {
    const repoInfo = await git.getRepoInfo(enterpriseBaseUrl).catch(() => null);
    if (!repoInfo) {
      return undefined;
    }

    const repoKey = git.repositoryPath;
    const ghClient = new GitHubClient(
      repoInfo.owner,
      repoInfo.repo,
      undefined,
      resolveGitHubHostConfig(repoInfo.host, enterpriseBaseUrl)
    );

    try {
      const prs = await ghClient.listOpenPullRequestsOrThrow();
      await this.cache.set(repoKey, prs);
      return prs;
    } catch (error) {
      this.logService.warn(`Stack GitHub PR fetch failed for ${repoKey}: ${error}`);
      if (this.cache.isFresh(repoKey)) {
        return this.cache.get(repoKey)?.prs;
      }
      return undefined;
    }
  }

  private async heuristicView(git: GitExecutor, trunk: string, currentBranch: string): Promise<StackView | undefined> {
    const heuristicParents = await detectLocalAncestryStacks(git, trunk, this.logService);
    await this.stackStore.applyDetection(heuristicEntriesFrom(heuristicParents));

    const [entries, refs] = await Promise.all([this.stackStore.getAll(), git.getAllRefListExtended()]);
    const liveBranches = new Set(refs.filter((ref) => !ref.remote && !ref.isTag).map((ref) => ref.name));
    const forest = buildStackForest(entries, liveBranches);
    const ordered = findStackContaining(currentBranch, forest);
    if (!ordered) {
      return undefined;
    }
    return stackViewFromForest(ordered, trunk, currentBranch, git.repositoryPath, this.aheadBehindFromRefs(refs, trunk));
  }

  /**
   * Ahead/behind of `branch`'s local tip vs. its remote-tracking ref (the
   * same `%(upstream:track)` data the Worktrees view renders as `⇡N ⇣N`).
   * Undefined when the branch has no upstream configured — nothing to fetch
   * or compare.
   */
  private async aheadBehindFor(git: GitExecutor, branch: string): Promise<StackAheadBehind | undefined> {
    try {
      const refs = await git.getAllRefListExtended();
      return this.aheadBehindFromRefs(refs, branch);
    } catch (error) {
      this.logService.warn(`Failed to compute ahead/behind for ${branch}: ${error}`);
      return undefined;
    }
  }

  private aheadBehindFromRefs(refs: IGitRef[], branch: string): StackAheadBehind | undefined {
    const ref = refs.find((entry) => !entry.remote && !entry.isTag && entry.name === branch);
    const track = ref?.parsedUpstreamTrack;
    return track ? { ahead: track[0], behind: track[1] } : undefined;
  }
}
