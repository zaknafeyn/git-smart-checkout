import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';
import { getStashMessage } from '../utils/getStashMessage';

export class PullWithStashCommand extends BaseCommand {
  configManager: ConfigurationManager;

  constructor(configManager: ConfigurationManager, logService: LoggingService) {
    super(logService);

    this.configManager = configManager;
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor();

    const currentBranch = await git.getCurrentBranch();
    const stashMessage = getStashMessage(currentBranch, true);
    // stash
    const isWorkdirHasChanges = await git.isWorkdirHasChanges();
    if (isWorkdirHasChanges) {
      await git.createStash(stashMessage, true);
    }

    // pull
    await git.pullFromRemoteBranch();

    // pop latest stash
    if (isWorkdirHasChanges) {
      await git.popStash(stashMessage);
    }
  }
}
