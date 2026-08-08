import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { checkoutRefWithStash } from '../utils/checkoutWithStashTail';

export class CheckoutPreviousCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private autoStashService: AutoStashService
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor();

      // Get current branch
      const currentBranch = await git.getCurrentBranch();
      if (!currentBranch) {
        throw new Error('The current workspace is not a git repository.');
      }

      // Get previous branch using git reflog
      const previousBranch = await git.getPreviousBranch();
      if (!previousBranch) {
        await this.showInformationMessage('No previous branch found in reflog.', 'OK');
        return;
      }

      this.logService.info(`Switching from ${currentBranch} to previous branch: ${previousBranch.fullName}`);

      const { outcome, autoStashMode } = await checkoutRefWithStash({
        git,
        currentBranch,
        targetRef: previousBranch,
        autoStashService: this.autoStashService,
      });
      if (outcome !== 'completed' && outcome !== 'rescued') {
        return;
      }

      capture(AnalyticsEvent.CheckoutPreviousBranch, { stash_mode: autoStashMode });

      await this.showInformationMessage(`Switched to previous branch: ${previousBranch.fullName}`, 'OK');
    } catch (error) {
      captureException(error);
      if (error instanceof Error) {
        const message = error.message;
        if (message) {
          await this.showErrorMessage(message, 'OK');
        }
      } else {
        await this.showErrorMessage('Unknown error', 'OK');
      }
    }
  }
}
