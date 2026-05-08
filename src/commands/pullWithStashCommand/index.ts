import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';

export class PullWithStashCommand extends BaseCommand {
  constructor(logService: LoggingService, private autoStashService: AutoStashService) {
    super(logService);
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor();
    const currentBranch = await git.getCurrentBranch();

    await this.autoStashService.pullAndStashChanges(git, currentBranch, 'merge');
  }
}

export class PullRebaseWithStashCommand extends BaseCommand {
  constructor(logService: LoggingService, private autoStashService: AutoStashService) {
    super(logService);
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor();
    const currentBranch = await git.getCurrentBranch();

    await this.autoStashService.pullAndStashChanges(git, currentBranch, 'rebase');
  }
}
