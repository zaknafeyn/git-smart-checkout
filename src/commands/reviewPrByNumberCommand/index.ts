import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitHubClient, resolveGitHubHostConfig } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import {
  PRReviewWorktreeRecord,
  PRReviewWorktreeStore,
} from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';
import { BaseCommand } from '../command';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../utils/parsePRInput';
import {
  ensureWorktreeParentDirectory,
  findWorktreeForBranch,
  PRReviewRepoInfo,
  recordPRReviewWorktree,
} from '../utils/prReviewWorktree';
import { showWorktreeCompletionActions } from '../utils/worktreeCompletionActions';
import { getBaseWorktreeDirectory, getSuggestedDirectoryName } from '../utils/worktreePath';
import { normalizePathForComparison, removeWorkspaceFoldersForPath } from '../utils/worktreeRemoval';

export const ACTION_REVIEW = 'Review';
export const ACTION_CANCEL = 'Cancel';
export const ACTION_OPEN_EXISTING = 'Open existing';
export const ACTION_UPDATE_TO_LATEST = 'Update to latest head';
export const ACTION_REMOVE_AND_RECREATE = 'Remove and recreate';
export const ACTION_RESET_BRANCH = 'Reset branch';

const PROGRESS_TITLE = 'Git Smart Checkout: Review PR by Number';
const REMOVE_COMMAND_HINT = 'When done: "GSC: Remove PR Review in Worktree..."';

export function getReviewBranchName(prNumber: number): string {
  return `pr/${prNumber}-review`;
}

interface ExistingReviewWorktree {
  worktreePath: string;
  branchName: string;
  recordId?: string;
}

/**
 * One-command PR review flow: PR number/URL → confirmation → `pull/<n>/head`
 * fetched → review worktree on a `pr/<n>-review` branch at the fetched head.
 * Re-invoking for a PR that already has a review worktree offers
 * open/update/recreate instead of creating a duplicate.
 */
export class ReviewPrByNumberCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider,
    private prReviewWorktreeStore?: PRReviewWorktreeStore
  ) {
    super(logService);
  }

  protected createGitHubClient(owner: string, repo: string, host: string): GitHubClient {
    const hostConfig = resolveGitHubHostConfig(host, this.configManager.get().githubEnterpriseBaseUrl);
    return new GitHubClient(owner, repo, undefined, hostConfig);
  }

  protected createWorktreeGitExecutor(worktreePath: string): GitExecutor {
    return new GitExecutor(worktreePath, this.logService, this.vscodeGitProvider);
  }

  protected async showCompletionActions(worktreePath: string, message: string): Promise<void> {
    await showWorktreeCompletionActions(worktreePath, message);
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
      const branchName = getReviewBranchName(prNumber);

      let pr: GitHubPR;
      try {
        pr = await this.createGitHubClient(repoInfo.owner, repoInfo.repo, repoInfo.host).fetchPullRequest(prNumber);
      } catch (e) {
        captureException(e);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch PR #${prNumber}: ${msg}`);
      }

      const existing = await this.findExistingReviewWorktree(git, repoInfo, prNumber, branchName);
      if (existing) {
        await this.handleExistingWorktree(git, repoInfo, pr, branchName, existing);
        return;
      }

      const author = pr.user?.login ? ` by @${pr.user.login}` : '';
      const confirmation = await this.showInformationMessage(
        `Review PR #${prNumber} '${pr.title}'${author} in a new worktree?`,
        ACTION_REVIEW,
        ACTION_CANCEL
      );

      if (confirmation !== ACTION_REVIEW) {
        return;
      }

      // The review branch can be left behind by a removed worktree; never reset
      // it silently — `-B` semantics only after the user confirms.
      let forceBranchReset = false;
      if (await git.branchExist(branchName)) {
        const resetChoice = await this.showWarningMessage(
          `Branch "${branchName}" already exists. Reset it to the latest PR head?`,
          ACTION_RESET_BRANCH,
          ACTION_CANCEL
        );

        if (resetChoice !== ACTION_RESET_BRANCH) {
          return;
        }

        forceBranchReset = true;
      }

      await this.createReviewWorktree(git, repoInfo, pr, branchName, forceBranchReset);
      capture(AnalyticsEvent.ReviewPrByNumber, { flow: 'create' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(message, 'OK'));
    }
  }

  private async handleExistingWorktree(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    pr: GitHubPR,
    branchName: string,
    existing: ExistingReviewWorktree
  ): Promise<void> {
    const choice = await this.showInformationMessage(
      `A review worktree for PR #${pr.number} already exists at ${existing.worktreePath}.`,
      ACTION_OPEN_EXISTING,
      ACTION_UPDATE_TO_LATEST,
      ACTION_REMOVE_AND_RECREATE
    );

    switch (choice) {
      case ACTION_OPEN_EXISTING:
        await recordPRReviewWorktree(
          this.prReviewWorktreeStore,
          git,
          repoInfo,
          pr,
          existing.worktreePath,
          existing.branchName
        );
        await this.showCompletionActions(
          existing.worktreePath,
          `PR #${pr.number} review worktree: ${existing.worktreePath}. ${REMOVE_COMMAND_HINT}`
        );
        capture(AnalyticsEvent.ReviewPrByNumber, { flow: 'open_existing' });
        return;
      case ACTION_UPDATE_TO_LATEST:
        await this.updateExistingWorktree(git, repoInfo, pr, existing);
        return;
      case ACTION_REMOVE_AND_RECREATE:
        await this.removeAndRecreate(git, repoInfo, pr, branchName, existing);
        return;
      default:
        return;
    }
  }

  private async updateExistingWorktree(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    pr: GitHubPR,
    existing: ExistingReviewWorktree
  ): Promise<void> {
    const worktreeGit = this.createWorktreeGitExecutor(existing.worktreePath);

    if (await worktreeGit.isWorkdirHasChanges()) {
      await this.showWarningMessage(
        `The review worktree at ${existing.worktreePath} has uncommitted changes. Commit, stash, or discard them before updating.`,
        'OK'
      );
      return;
    }

    const confirmation = await this.showWarningMessage(
      `Update PR #${pr.number} review worktree to the latest head? This runs "git reset --hard" in ${existing.worktreePath}.`,
      ACTION_UPDATE_TO_LATEST,
      ACTION_CANCEL
    );

    if (confirmation !== ACTION_UPDATE_TO_LATEST) {
      return;
    }

    const headSha = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: PROGRESS_TITLE,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: `Fetching PR #${pr.number} head...` });
        // The fetch runs in the MAIN repository; FETCH_HEAD is per-worktree, so
        // resolve the fetched SHA here and reset the review worktree to it
        // explicitly with the worktree's own executor.
        await git.fetchPullRequestHead(pr.number);
        const sha = await git.revParse('FETCH_HEAD');

        progress.report({ message: 'Updating worktree...' });
        await worktreeGit.resetHardTo(sha);
        return sha;
      }
    );

    await recordPRReviewWorktree(
      this.prReviewWorktreeStore,
      git,
      repoInfo,
      pr,
      existing.worktreePath,
      existing.branchName,
      headSha
    );
    await this.showCompletionActions(
      existing.worktreePath,
      `PR #${pr.number} review worktree updated to ${headSha.slice(0, 7)}. ${REMOVE_COMMAND_HINT}`
    );
    capture(AnalyticsEvent.ReviewPrByNumber, { flow: 'update' });
  }

  private async removeAndRecreate(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    pr: GitHubPR,
    branchName: string,
    existing: ExistingReviewWorktree
  ): Promise<void> {
    const worktreeGit = this.createWorktreeGitExecutor(existing.worktreePath);

    if (await worktreeGit.isWorkdirHasChanges()) {
      const confirmation = await this.showWarningMessage(
        `The review worktree at ${existing.worktreePath} has uncommitted changes that will be lost. Remove it anyway?`,
        ACTION_REMOVE_AND_RECREATE,
        ACTION_CANCEL
      );

      if (confirmation !== ACTION_REMOVE_AND_RECREATE) {
        return;
      }
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: PROGRESS_TITLE,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Removing existing worktree...' });
        await git.worktreeRemove(existing.worktreePath, true);
      }
    );

    await removeWorkspaceFoldersForPath(existing.worktreePath);
    if (existing.recordId) {
      await this.prReviewWorktreeStore?.remove(existing.recordId);
    }

    // The review branch survives the worktree removal, so recreating needs `-B`.
    const forceBranchReset = await git.branchExist(branchName);
    await this.createReviewWorktree(git, repoInfo, pr, branchName, forceBranchReset);
    capture(AnalyticsEvent.ReviewPrByNumber, { flow: 'recreate' });
  }

  private async createReviewWorktree(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    pr: GitHubPR,
    branchName: string,
    forceBranchReset: boolean
  ): Promise<void> {
    const worktreePath = this.resolveNewWorktreePath(git.repositoryPath, branchName);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: PROGRESS_TITLE,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: `Fetching PR #${pr.number} head...` });
        await git.fetchPullRequestHead(pr.number);
        const headSha = await git.revParse('FETCH_HEAD');

        progress.report({ message: 'Creating worktree...' });
        ensureWorktreeParentDirectory(worktreePath);
        await git.worktreeAddAtRef(worktreePath, branchName, headSha, forceBranchReset);
        await recordPRReviewWorktree(
          this.prReviewWorktreeStore,
          git,
          repoInfo,
          pr,
          worktreePath,
          branchName,
          headSha
        );
      }
    );

    await this.showCompletionActions(
      worktreePath,
      `PR #${pr.number} review worktree created at ${worktreePath}. ${REMOVE_COMMAND_HINT}`
    );
  }

  private async findExistingReviewWorktree(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    prNumber: number,
    branchName: string
  ): Promise<ExistingReviewWorktree | undefined> {
    const record = await this.findStoreRecord(git, repoInfo, prNumber);

    if (record) {
      const worktrees = await git.worktreeListDetailed(true);
      const worktree = worktrees.find(
        (item) =>
          !item.bare &&
          !item.prunable &&
          normalizePathForComparison(item.path) === normalizePathForComparison(record.worktreePath)
      );

      if (worktree) {
        return {
          worktreePath: worktree.path,
          branchName: record.branchName,
          recordId: record.id,
        };
      }
    }

    const worktreeByBranch = await findWorktreeForBranch(git, branchName);
    if (worktreeByBranch) {
      return { worktreePath: worktreeByBranch.path, branchName };
    }

    return undefined;
  }

  private async findStoreRecord(
    git: GitExecutor,
    repoInfo: PRReviewRepoInfo,
    prNumber: number
  ): Promise<PRReviewWorktreeRecord | undefined> {
    if (!this.prReviewWorktreeStore) {
      return undefined;
    }

    const records = await this.prReviewWorktreeStore.getForRepository({
      repoKey: PRReviewWorktreeStore.createRepoKey(repoInfo.owner, repoInfo.repo, git.repositoryPath),
      repositoryPath: git.repositoryPath,
    });

    return records.find((record) => record.prNumber === prNumber);
  }

  private resolveNewWorktreePath(repositoryPath: string, branchName: string): string {
    const baseDirectory = getBaseWorktreeDirectory(
      repositoryPath,
      this.configManager.get().defaultWorktreeDirectory
    );
    const suggestedName = getSuggestedDirectoryName(repositoryPath, branchName);

    let candidate = path.join(baseDirectory, suggestedName);
    for (let suffix = 2; fs.existsSync(candidate); suffix++) {
      candidate = path.join(baseDirectory, `${suggestedName}-${suffix}`);
    }

    return candidate;
  }
}
