import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';

export class CheckoutPreviousCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private autoStashService: AutoStashService
  ) {
    super(logService);
    this.logService = logService;
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

      // Get auto stash mode
      const autoStashMode = await this.autoStashService.getAutoStashMode();
      if (!autoStashMode) {
        return;
      }

      // Perform checkout with auto stash
      await this.autoStashService.checkoutAndStashChanges(git, currentBranch, previousBranch, autoStashMode);

      await this.showInformationMessage(`Switched to previous branch: ${previousBranch.fullName}`, 'OK');
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message;
        message && (await this.showErrorMessage(message, 'OK'));
      } else {
        await this.showErrorMessage('Unknown error', 'OK');
      }
    }
  }

}
