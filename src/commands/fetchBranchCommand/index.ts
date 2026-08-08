import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

export interface FetchBranchArgs {
  branch: string;
  /** Repository root to fetch in; resolved from the workspace when omitted. */
  repositoryPath?: string;
  /** Remote to fetch from; auto-detected from the branch's configured upstream, falling back to "origin". */
  remote?: string;
}

/**
 * Fetches a single branch's latest commits from its remote, updating the
 * remote-tracking ref (`refs/remotes/<remote>/<branch>`) without touching
 * the working tree or checking anything out. Argument-only (not contributed
 * to package.json / the command palette) — driven by UI surfaces that
 * already know which branch and repository they mean, such as the "Fetch
 * latest changes" button on a stack's target branch in the Stacks webview.
 */
export class FetchBranchCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(args: FetchBranchArgs | string): Promise<void> {
    const normalized: FetchBranchArgs = typeof args === 'string' ? { branch: args } : args;
    const { branch, repositoryPath, remote } = normalized;

    try {
      const git = repositoryPath
        ? new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider)
        : await this.getGitExecutor(this.vscodeGitProvider);

      const resolvedRemote = remote ?? (await git.getUpstreamRemote(branch)) ?? 'origin';
      await git.fetchSpecificBranch(branch, resolvedRemote);

      capture(AnalyticsEvent.FetchStackBaseBranch);
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      await this.showErrorMessage(`Failed to fetch "${branch}": ${message}`, 'OK');
    }
  }
}
