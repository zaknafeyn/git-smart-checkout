import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { LoggingService } from '../logging/loggingService';

export abstract class PrCloneServiceBase {
  constructor(
    protected git: GitExecutor,
    protected ghClient: GitHubClient,
    protected loggingService: LoggingService
  ) {}
}
