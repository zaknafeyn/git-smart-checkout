import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';
import { checkoutRefWithStash } from '../utils/checkoutWithStashTail';

export interface CheckoutBranchArgs {
  branch: string;
  /** Repository root to check out in; resolved from the workspace when omitted. */
  repositoryPath?: string;
  /** Remote the branch should be tracked from, when it doesn't exist locally yet. */
  remote?: string;
}

/**
 * Checks out a branch by name using the currently active stash strategy.
 * Argument-only (not contributed to package.json / the command palette) —
 * driven by UI surfaces that already know which branch and repository they
 * mean, such as the Stacks webview.
 */
export class CheckoutBranchCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(args: CheckoutBranchArgs | string): Promise<void> {
    try {
      const normalized: CheckoutBranchArgs = typeof args === 'string' ? { branch: args } : args;
      const { branch, repositoryPath, remote } = normalized;

      const git = repositoryPath
        ? new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider)
        : await this.getGitExecutor(this.vscodeGitProvider);

      const currentBranch = await git.getCurrentBranch();
      if (currentBranch === branch) {
        await this.showInformationMessage(`Already on branch "${branch}".`, 'OK');
        return;
      }

      const targetRef = await this.resolveTargetRef(git, branch, remote);

      const { outcome } = await checkoutRefWithStash({
        git,
        currentBranch,
        targetRef,
        autoStashService: this.autoStashService,
      });

      if (outcome !== 'completed' && outcome !== 'rescued') {
        return;
      }

      capture(AnalyticsEvent.CheckoutStackBranch);
    } catch (error) {
      captureException(error);
      if (error instanceof Error) {
        const message = error.message;
        message && (await this.showErrorMessage(message, 'OK'));
      } else {
        await this.showErrorMessage('Unknown error', 'OK');
      }
    }
  }

  /**
   * Builds an `IGitRef` for `branch`, preferring a live local ref and falling
   * back to a remote-tracking ref (which lets `GitExecutor.checkout` create
   * the local tracking branch on demand) when the branch only exists on
   * `remote`.
   */
  private async resolveTargetRef(git: GitExecutor, branch: string, remote?: string): Promise<IGitRef> {
    const refs = await git.getAllRefListExtended();
    const localRef = refs.find((ref) => !ref.remote && !ref.isTag && ref.name === branch);
    if (localRef) {
      return localRef;
    }

    const remoteRef = refs.find(
      (ref) => !ref.isTag && ref.remote && ref.name === branch && (!remote || ref.remote === remote)
    );
    if (remoteRef) {
      return remoteRef;
    }

    if (remote) {
      return { name: branch, fullName: `${remote}/${branch}`, remote, authorName: '' };
    }

    throw new Error(`Branch "${branch}" was not found locally or on a remote.`);
  }
}
