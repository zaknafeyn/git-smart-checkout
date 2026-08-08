import * as vscode from 'vscode';

import { GitHubClient, resolveGitHubHostConfig } from '../../common/api/ghClient';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';
import { BaseCommand } from '../command';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { checkoutRefWithStash } from '../utils/checkoutWithStashTail';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../utils/parsePRInput';
import { resolveGitHubRemoteInteractive } from '../../utils/remoteSelection';

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

      // Tracks which remote the branch was actually fetched from (same-repo PR
      // path only — fork PRs fetch by URL, not by remote name) so the later
      // checkout uses that same remote instead of silently defaulting to
      // 'origin', which would break or misresolve on multi-remote repos.
      let fetchedFromRemote: string | undefined;

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
            fetchedFromRemote = await resolveGitHubRemoteInteractive(git, {
              branch: headRef,
              defaultRemote: this.configManager.get().defaultRemote,
              purpose: 'fetch',
              githubRepo: pr.base.repo?.full_name,
            });
            await git.fetchSpecificBranch(headRef, fetchedFromRemote);
          }
        }
      );

      if (isAlreadyOnPrBranch) {
        await this.showInformationMessage('You are already on the PR branch; pull skipped.', 'OK');
        return;
      }

      const prBranch: IGitRef = {
        name: headRef,
        fullName: fetchedFromRemote ? `${fetchedFromRemote}/${headRef}` : headRef,
        remote: fetchedFromRemote,
        authorName: '',
        comment: pr.title,
      };

      const { outcome, autoStashMode } = await checkoutRefWithStash({
        git,
        currentBranch,
        targetRef: prBranch,
        autoStashService: this.autoStashService,
      });
      if (outcome !== 'completed' && outcome !== 'rescued') {
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
