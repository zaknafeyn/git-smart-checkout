import * as vscode from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';
import { BaseCommand } from '../command';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';

function parsePRInput(input: string): number | null {
  const num = input.trim().match(/^#?(\d+)$/);
  if (num) {
    return parseInt(num[1], 10);
  }
  const url = input.trim().match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (url) {
    return parseInt(url[1], 10);
  }
  return null;
}

export class CheckoutByPRCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  protected createGitHubClient(owner: string, repo: string): GitHubClient {
    return new GitHubClient(owner, repo);
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

      const prNumber = parsePRInput(input);
      if (!prNumber) {
        await this.showErrorMessage('Invalid input. Enter a PR number (e.g. 123 or #123) or a GitHub PR URL.', 'OK');
        return;
      }

      const git = await this.getGitExecutor(this.vscodeGitProvider);
      const repoInfo = await git.getRepoInfo();
      if (!repoInfo) {
        throw new Error('Could not determine GitHub repository information. Make sure the remote is a GitHub repository.');
      }

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

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Git Smart Checkout',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: `Fetching PR #${prNumber} branch "${headRef}"...` });

          if (isFork && pr.head.repo?.clone_url) {
            await git.fetchFromUrl(pr.head.repo.clone_url, headRef);
          } else {
            await git.fetchSpecificBranch(headRef, 'origin');
          }
        }
      );

      const currentBranch = await git.getCurrentBranch();

      const autoStashMode = await this.autoStashService.getAutoStashMode();
      if (!autoStashMode) {
        return;
      }

      const prBranch: IGitRef = {
        name: headRef,
        fullName: headRef,
        authorName: '',
        comment: pr.title,
      };

      await this.autoStashService.checkoutAndStashChanges(git, currentBranch, prBranch, autoStashMode);

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
