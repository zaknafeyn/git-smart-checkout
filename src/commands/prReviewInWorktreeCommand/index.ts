import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef, IGitWorktree } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';
import { BaseCommand } from '../command';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../utils/parsePRInput';
import { completeWorktreeCreation, showWorktreeCompletionActions } from '../utils/worktreeCompletionActions';
import { selectWorktreePath } from '../utils/worktreePath';
import { resolveGitHubRemoteInteractive } from '../../utils/remoteSelection';
import { WorktreeSetupService } from '../../services/worktreeSetupService';

export class PRReviewInWorktreeCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider,
    private prReviewWorktreeStore?: PRReviewWorktreeStore,
    private worktreeSetupService?: WorktreeSetupService
  ) {
    super(logService);
  }

  /** Falls back to an in-memory (non-persisted) consent store when no shared instance was injected. */
  private getWorktreeSetupService(): WorktreeSetupService {
    if (!this.worktreeSetupService) {
      const memory = new Map<string, unknown>();
      this.worktreeSetupService = new WorktreeSetupService(this.configManager, this.logService, {
        get: <T>(key: string, defaultValue?: T) => (memory.has(key) ? (memory.get(key) as T) : defaultValue) as T,
        update: async (key: string, value: unknown) => {
          memory.set(key, value);
        },
      });
    }

    return this.worktreeSetupService;
  }

  protected createGitHubClient(owner: string, repo: string): GitHubClient {
    return new GitHubClient(owner, repo);
  }

  async execute(): Promise<void> {
    try {
      const input = await this.showInputBox({
        placeHolder: 'PR number (#123) or GitHub PR URL',
        prompt: 'Enter a pull request number or URL to review in a worktree',
      });

      if (!input) {
        return;
      }

      const parsedInput = parsePRInput(input);
      if (!parsedInput) {
        await this.showErrorMessage(INVALID_PR_INPUT_MESSAGE, 'OK');
        return;
      }

      const git = await this.getGitExecutor(this.vscodeGitProvider);
      const repoInfo = await git.getRepoInfo();
      if (!repoInfo) {
        throw new Error('Could not determine GitHub repository information. Make sure the remote is a GitHub repository.');
      }

      const repositoryMismatchMessage = getRepositoryMismatchMessage(parsedInput, repoInfo);
      if (repositoryMismatchMessage) {
        await this.showErrorMessage(repositoryMismatchMessage, 'OK');
        return;
      }

      const { prNumber } = parsedInput;
      let pr: Awaited<ReturnType<GitHubClient['fetchPullRequest']>>;
      try {
        pr = await this.createGitHubClient(repoInfo.owner, repoInfo.repo).fetchPullRequest(prNumber);
      } catch (e) {
        captureException(e);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch PR #${prNumber}: ${msg}`);
      }

      const headRef = pr.head.ref;
      const isFork = pr.head.repo?.full_name !== pr.base.repo?.full_name;
      const existingWorktree = await this.findWorktreeForBranch(git, headRef);

      if (existingWorktree) {
        await this.recordPRReviewWorktree(git, repoInfo, pr, existingWorktree.path);
        await showWorktreeCompletionActions(
          existingWorktree.path,
          `Branch "${headRef}" is already checked out at ${existingWorktree.path}`
        );
        capture(AnalyticsEvent.PrReviewInWorktree, { is_fork: isFork, existing_worktree: true });
        return;
      }

      const targetBranch = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: PR Review in Worktree',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: `Fetching PR #${prNumber} branch "${headRef}"...` });
          const remoteName = isFork
            ? undefined
            : await resolveGitHubRemoteInteractive(git, {
                branch: headRef,
                defaultRemote: this.configManager.get().defaultRemote,
                purpose: 'fetch',
                githubRepo: pr.base.repo?.full_name,
              });
          await this.fetchPRBranch(git, headRef, isFork ? pr.head.repo?.clone_url : undefined, remoteName);

          return await this.resolveFetchedBranch(git, headRef, remoteName);
        }
      );

      const worktreePath = await selectWorktreePath(
        git.repositoryPath,
        headRef,
        this.configManager.get().defaultWorktreeDirectory,
        'Git Smart Checkout: PR Review in Worktree'
      );

      if (!worktreePath) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout: PR Review in Worktree',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating worktree...' });
          fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
          await this.createWorktree(git, worktreePath, targetBranch);
          await this.recordPRReviewWorktree(git, repoInfo, pr, worktreePath);
        }
      );

      await completeWorktreeCreation({
        worktreeSetupService: this.getWorktreeSetupService(),
        sourceRoot: git.repositoryPath,
        worktreePath,
        baseMessage: `PR #${prNumber} worktree created at ${worktreePath}`,
      });

      capture(AnalyticsEvent.PrReviewInWorktree, { is_fork: isFork, existing_worktree: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      message && (await vscode.window.showErrorMessage(message, 'OK'));
    }
  }

  private async fetchPRBranch(
    git: GitExecutor,
    headRef: string,
    forkCloneUrl?: string,
    remoteName = 'origin'
  ): Promise<void> {
    if (forkCloneUrl) {
      await git.fetchFromUrl(forkCloneUrl, headRef);
      return;
    }

    await git.fetchSpecificBranch(headRef, remoteName);
  }

  private async resolveFetchedBranch(git: GitExecutor, headRef: string, remoteName = 'origin'): Promise<IGitRef> {
    const refs = await git.getAllRefListExtended();
    const localBranch = refs.find((ref) => !ref.isTag && !ref.remote && ref.name === headRef);

    if (localBranch) {
      return localBranch;
    }

    const remoteBranch = refs.find(
      (ref) => !ref.isTag && ref.remote === remoteName && ref.name === headRef
    );

    if (remoteBranch) {
      return remoteBranch;
    }

    throw new Error(`Could not find fetched PR branch "${headRef}".`);
  }

  private async createWorktree(
    git: GitExecutor,
    worktreePath: string,
    targetBranch: IGitRef
  ): Promise<void> {
    if (targetBranch.remote) {
      await git.worktreeAddRemoteBranch(worktreePath, targetBranch.name, targetBranch.fullName);
      return;
    }

    await git.worktreeAddLocalBranch(worktreePath, targetBranch.name);
  }

  private async recordPRReviewWorktree(
    git: GitExecutor,
    repoInfo: { owner: string; repo: string },
    pr: GitHubPR,
    worktreePath: string
  ): Promise<void> {
    await this.prReviewWorktreeStore?.upsert({
      repoKey: PRReviewWorktreeStore.createRepoKey(repoInfo.owner, repoInfo.repo, git.repositoryPath),
      repositoryPath: git.repositoryPath,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      worktreePath,
      branchName: pr.head.ref,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
      headSha: pr.head.sha,
    });
  }

  private async findWorktreeForBranch(
    git: GitExecutor,
    branchName: string
  ): Promise<IGitWorktree | undefined> {
    const expectedBranchRef = `refs/heads/${branchName}`;
    const worktrees = await git.worktreeListDetailed(true);

    return worktrees.find(
      (worktree) =>
        !worktree.bare &&
        !worktree.prunable &&
        worktree.branch === expectedBranchRef
    );
  }
}
