import * as vscode from 'vscode';

import { GitHubClient, resolveGitHubHostConfig } from '../../common/api/ghClient';
import { AUTO_STASH_IGNORE } from '../checkoutToCommand/constants';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';
import { BaseCommand } from '../command';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../utils/parsePRInput';
import { findWorktreeForBranch, handleWorktreeBranchConflict } from '../utils/worktreeBranchConflict';

export class CheckoutByPRCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  protected createGitHubClient(owner: string, repo: string, host: string): GitHubClient {
    const hostConfig = resolveGitHubHostConfig(host, this.configManager.get().githubEnterpriseBaseUrl);
    return new GitHubClient(owner, repo, undefined, hostConfig);
  }

  async execute(): Promise<void> {
    try {
      const input = await this.showInputBox({
        placeHolder: 'PR number (#123) or GitHub PR URL',
        prompt: 'Enter a pull request number or URL to checkout its branch',
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

      const currentBranch = await git.getCurrentBranch();
      const isAlreadyOnPrBranch = isFork && currentBranch === headRef;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: `Fetching PR #${prNumber} branch "${headRef}"...` });

          if (isFork && pr.head.repo?.clone_url) {
            // Git refuses to force-update the branch that is currently checked
            // out, so fetch to FETCH_HEAD instead and let the user know.
            await git.fetchFromUrl(pr.head.repo.clone_url, headRef, isAlreadyOnPrBranch);
          } else {
            await git.fetchSpecificBranch(headRef, 'origin');
          }
        }
      );

      if (isAlreadyOnPrBranch) {
        await this.showInformationMessage('You are already on the PR branch; pull skipped.', 'OK');
        return;
      }

      const isDirty = await git.isWorkdirHasChanges();
      const autoStashMode = isDirty
        ? await this.autoStashService.getAutoStashMode()
        : AUTO_STASH_IGNORE;
      if (!autoStashMode) {
        return;
      }

      const prBranch: IGitRef = {
        name: headRef,
        fullName: headRef,
        authorName: '',
        comment: pr.title,
      };

      const conflictWorktree = await findWorktreeForBranch(git, prBranch.name);
      if (conflictWorktree) {
        const result = await handleWorktreeBranchConflict(prBranch.fullName, conflictWorktree.path);
        if (result.action === 'createBranch') {
          try {
            await git.createBranch(result.newBranchName, prBranch.fullName);
            capture(AnalyticsEvent.BranchCreated);
          } catch (e) {
            captureException(e);
            const msg = e instanceof Error ? e.message : String(e);
            await vscode.window.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
          }
        }
        return;
      }

      const outcome = await this.autoStashService.checkoutAndStashChanges(git, currentBranch, prBranch, autoStashMode);
      if (outcome === 'cancelled') {
        return;
      }

      await this.showInformationMessage(`Switched to PR #${prNumber}: ${pr.title}`, 'OK');

      capture(AnalyticsEvent.CheckoutByPR, { stash_mode: autoStashMode, is_fork: isFork });
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message;
        message && (await vscode.window.showErrorMessage(message, 'OK'));
      } else {
        await vscode.window.showErrorMessage('Unknown error', 'OK');
      }
    }
  }
}
