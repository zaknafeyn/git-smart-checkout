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
    const isWorkdirHasChangesBeforeStash = await git.isWorkdirHasChanges();
    if (isWorkdirHasChangesBeforeStash) {
      await git.createStash(stashMessage);
    }

    // pull
    await git.pullFromRemoteBranch();

    // pop latest stash
    if (isWorkdirHasChangesBeforeStash) {
      // check for auto generated files that running application might generate after pull
      const isWorkdirHasChanges = await git.isWorkdirHasChanges();
      if (isWorkdirHasChanges) {
        // if such changes present, reset them
        await git.resetLocalChanges();
      }

      // .. proceed to stash pop
      await git.popStash(stashMessage);
    }
  }
}
