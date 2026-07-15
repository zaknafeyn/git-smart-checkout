import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitHubClient, resolveGitHubHostConfig } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { BaseCommand } from '../command';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../utils/parsePRInput';
import {
  ensureWorktreeParentDirectory,
  findWorktreeForBranch,
  recordPRReviewWorktree,
} from '../utils/prReviewWorktree';
import { completeWorktreeCreation, showWorktreeCompletionActions } from '../utils/worktreeCompletionActions';
import { selectWorktreePath } from '../utils/worktreePath';
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

  protected createGitHubClient(owner: string, repo: string, host: string): GitHubClient {
    const hostConfig = resolveGitHubHostConfig(host, this.configManager.get().githubEnterpriseBaseUrl);
    return new GitHubClient(owner, repo, undefined, hostConfig);
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
      const repoInfo = await git.getRepoInfo(this.configManager.get().githubEnterpriseBaseUrl);
      if (!repoInfo) {
        throw new Error(
          'Could not determine GitHub repository information. Make sure the remote is a GitHub repository, or configure git-smart-checkout.githubEnterpriseBaseUrl for a GitHub Enterprise remote.'
        );
      }

      const repositoryMismatchMessage = getRepositoryMismatchMessage(parsedInput, repoInfo);
      if (repositoryMismatchMessage) {
        await this.showErrorMessage(repositoryMismatchMessage, 'OK');
        return;
      }

      const { prNumber } = parsedInput;
      let pr: Awaited<ReturnType<GitHubClient['fetchPullRequest']>>;
      try {
        pr = await this.createGitHubClient(repoInfo.owner, repoInfo.repo, repoInfo.host).fetchPullRequest(prNumber);
      } catch (e) {
        captureException(e);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch PR #${prNumber}: ${msg}`);
      }

      const headRef = pr.head.ref;
      const isFork = pr.head.repo?.full_name !== pr.base.repo?.full_name;
      const existingWorktree = await findWorktreeForBranch(git, headRef);

      if (existingWorktree) {
        await recordPRReviewWorktree(this.prReviewWorktreeStore, git, repoInfo, pr, existingWorktree.path);
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
          await this.fetchPRBranch(git, headRef, isFork ? pr.head.repo?.clone_url : undefined);

          return await this.resolveFetchedBranch(git, headRef);
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
          ensureWorktreeParentDirectory(worktreePath);
          await this.createWorktree(git, worktreePath, targetBranch);
          await recordPRReviewWorktree(this.prReviewWorktreeStore, git, repoInfo, pr, worktreePath);
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
    forkCloneUrl?: string
  ): Promise<void> {
    if (forkCloneUrl) {
      await git.fetchFromUrl(forkCloneUrl, headRef);
      return;
    }

    await git.fetchSpecificBranch(headRef, 'origin');
  }

  private async resolveFetchedBranch(git: GitExecutor, headRef: string): Promise<IGitRef> {
    const refs = await git.getAllRefListExtended();
    const localBranch = refs.find((ref) => !ref.isTag && !ref.remote && ref.name === headRef);

    if (localBranch) {
      return localBranch;
    }

    const originBranch = refs.find(
      (ref) => !ref.isTag && ref.remote === 'origin' && ref.name === headRef
    );

    if (originBranch) {
      return originBranch;
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

}
