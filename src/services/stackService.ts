import * as vscode from 'vscode';

import { GitHubClient, resolveGitHubHostConfig } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitRef } from '../common/git/types';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';
import { findGithubStackForBranch, prStackFromGithubStack } from './prStack';
import { StackAheadBehind, StackView, stackViewFromPrStack } from './stackModel';

export interface StackRefreshResult {
  view?: StackView;
  currentBranch?: string;
  isDetached: boolean;
}

/**
 * Orchestrates a stacks refresh: GitHub's native Stacks API
 * (https://docs.github.com/en/rest/pulls/stacks) is the sole source — a
 * branch is stacked exactly when it's the target or a stacked PR's head in
 * one of the repository's stacks, with no configuration knob and no local
 * fallback. Nothing is cached: a stack can be dissolved on GitHub at any
 * time, so every refresh re-fetches live rather than risking a stale view.
 */
export class StackService {
  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly logService: LoggingService,
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
    const ghClient = await this.buildGithubClient(git, config.githubEnterpriseBaseUrl);
    if (!ghClient) {
      return { currentBranch, isDetached: false };
    }

    const [prs, stacks] = await Promise.all([
      this.fetchPrs(ghClient, git.repositoryPath),
      this.fetchStacks(ghClient, git.repositoryPath),
    ]);

    const githubStack = findGithubStackForBranch(stacks, currentBranch);
    const view = githubStack
      ? stackViewFromPrStack(
          prStackFromGithubStack(githubStack, prs, currentBranch, (n) => ghClient.pullRequestUrl(n)),
          currentBranch,
          git.repositoryPath,
          await this.aheadBehindFor(git, githubStack.base.ref)
        )
      : undefined;
    return { view, currentBranch, isDetached: false };
  }

  /** Builds a `GitHubClient` for `git`'s repository, or `undefined` when it's not a GitHub repo. */
  private async buildGithubClient(git: GitExecutor, enterpriseBaseUrl: string): Promise<GitHubClient | undefined> {
    const repoInfo = await git.getRepoInfo(enterpriseBaseUrl).catch(() => null);
    if (!repoInfo) {
      return undefined;
    }
    return new GitHubClient(
      repoInfo.owner,
      repoInfo.repo,
      undefined,
      resolveGitHubHostConfig(repoInfo.host, enterpriseBaseUrl)
    );
  }

  /** Open-PR list, live — used only to enrich stack members with title/URL. Swallows failure to an empty list. */
  private async fetchPrs(ghClient: GitHubClient, repoKey: string) {
    try {
      return await ghClient.listOpenPullRequestsOrThrow();
    } catch (error) {
      this.logService.warn(`Stack GitHub PR fetch failed for ${repoKey}: ${error}`);
      return [];
    }
  }

  /** GitHub-native stack list, live. Swallows failure to an empty list (no stack found). */
  private async fetchStacks(ghClient: GitHubClient, repoKey: string) {
    try {
      return await ghClient.listPullRequestStacksOrThrow();
    } catch (error) {
      this.logService.warn(`Stack GitHub stacks fetch failed for ${repoKey}: ${error}`);
      return [];
    }
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
      const ref = refs.find((entry: IGitRef) => !entry.remote && !entry.isTag && entry.name === branch);
      const track = ref?.parsedUpstreamTrack;
      return track ? { ahead: track[0], behind: track[1] } : undefined;
    } catch (error) {
      this.logService.warn(`Failed to compute ahead/behind for ${branch}: ${error}`);
      return undefined;
    }
  }
}
