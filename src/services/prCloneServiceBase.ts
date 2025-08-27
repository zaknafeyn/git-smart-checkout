import { Disposable } from 'vscode';
import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { LoggingService } from '../logging/loggingService';
import { ICleanUpActions } from './prCloneService';

export abstract class PrCloneServiceBase extends Disposable {
  protected finishProgress: (() => void) | undefined;
  protected cancelProgress: (() => void) | undefined;
  protected cleanUpActionBegin: (() => void)[] = [];
  protected cleanUpActionEnd: (() => void)[] = [];

  constructor(
    protected git: GitExecutor,
    protected ghClient: GitHubClient,
    protected loggingService: LoggingService
  ) {
    super(() => {});
  }

  protected abstract cleanUp(isAborting: boolean): Promise<void>;

  public abstract cherryPickNext(isContinue: boolean): Promise<void>;

  public abstract dispose(): any;

  addCleanUpActions({ cleanUpActionBegin, cleanUpActionEnd }: ICleanUpActions) {
    if (cleanUpActionBegin) {
      this.cleanUpActionBegin.push(cleanUpActionBegin);
    }

    if (cleanUpActionEnd) {
      this.cleanUpActionEnd.push(cleanUpActionEnd);
    }
  }

  abortClonePR() {
    this.cancelProgress?.();
    this.cleanUp(true);
  }
}
