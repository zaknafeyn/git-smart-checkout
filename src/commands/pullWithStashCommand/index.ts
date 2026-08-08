import { LoggingService } from '../../logging/loggingService';
import { AutoStashService, TPullWithStashStrategy } from '../../services/autoStashService';
import { BaseCommand } from '../command';

abstract class BasePullWithStashCommand extends BaseCommand {
  protected abstract readonly pullMode: TPullWithStashStrategy;

  constructor(logService: LoggingService, private autoStashService: AutoStashService) {
    super(logService);
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor();
    const currentBranch = await git.getCurrentBranch();

    await this.autoStashService.pullAndStashChanges(git, currentBranch, this.pullMode);
  }
}

export class PullWithStashCommand extends BasePullWithStashCommand {
  protected readonly pullMode: TPullWithStashStrategy = 'merge';
}

export class PullRebaseWithStashCommand extends BasePullWithStashCommand {
  protected readonly pullMode: TPullWithStashStrategy = 'rebase';
}
