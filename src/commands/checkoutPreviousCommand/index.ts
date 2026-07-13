import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';
import { AUTO_STASH_IGNORE } from '../checkoutToCommand/constants';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { findWorktreeForBranch, handleWorktreeBranchConflict } from '../utils/worktreeBranchConflict';

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

      const conflictWorktree = await findWorktreeForBranch(git, previousBranch.name);
      if (conflictWorktree) {
        const result = await handleWorktreeBranchConflict(previousBranch.fullName, conflictWorktree.path);
        if (result.action === 'createBranch') {
          try {
            await git.createBranch(result.newBranchName, previousBranch.fullName);
            capture(AnalyticsEvent.BranchCreated);
          } catch (e) {
            captureException(e);
            const msg = e instanceof Error ? e.message : String(e);
            await this.showErrorMessage(`Failed to create the new branch: ${msg}`, 'OK');
          }
        }
        return;
      }

      // Get auto stash mode (skip the prompt entirely when the tree is clean)
      const isDirty = await git.isWorkdirHasChanges();
      const autoStashMode = isDirty
        ? await this.autoStashService.getAutoStashMode()
        : AUTO_STASH_IGNORE;
      if (!autoStashMode) {
        return;
      }

      // Perform checkout with auto stash
      const outcome = await this.autoStashService.checkoutAndStashChanges(git, currentBranch, previousBranch, autoStashMode);
      if (outcome === 'cancelled') {
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
