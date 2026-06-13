import { env } from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { LoggingService } from '../../logging/loggingService';
import { showAutoDismissNotification } from '../../utils/showAutoDismissNotification';
import { BaseCommand } from '../command';

export class CopyBranchNameCommand extends BaseCommand {
  constructor(logService: LoggingService) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor();

      const branch = await git.getCurrentBranch();
      if (!branch) {
        throw new Error('The current workspace is not a git repository.');
      }

      await env.clipboard.writeText(branch);

      this.logService.info(`Copied current branch name to clipboard: ${branch}`);
      capture(AnalyticsEvent.CopyBranchName);

      showAutoDismissNotification(`Copied branch name to clipboard: ${branch}`);
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
