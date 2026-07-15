import { Disposable } from 'vscode';
import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { resolveGitHubRemoteInteractive } from '../utils/remoteSelection';
import { ICleanUpActions } from './prCloneService';

export abstract class PrCloneServiceBase extends Disposable {
  protected finishProgress: (() => void) | undefined;
  protected cancelProgress: (() => void) | undefined;
  protected cleanUpActionBegin: (() => void | Promise<void>)[] = [];
  protected cleanUpActionEnd: (() => void | Promise<void>)[] = [];

  constructor(
    protected git: GitExecutor,
    protected ghClient: GitHubClient,
    protected loggingService: LoggingService,
    protected configurationManager?: ConfigurationManager
  ) {
    super(() => {});
  }

  protected abstract cleanUp(isAborting: boolean): Promise<void>;

  /**
   * Resolves the remote to use for a GitHub-specific fetch/push in the PR
   * clone flow, preferring the remote whose URL matches `githubRepo` (a
   * PR's base repo, `owner/repo`). When no `ConfigurationManager` was
   * supplied (e.g. unit tests constructing this service directly), falls
   * back to `'origin'` so single-remote-repo behavior is unchanged.
   */
  protected async resolvePrCloneRemote(opts: {
    branch?: string;
    purpose: 'fetch' | 'push';
    githubRepo?: string;
  }): Promise<string> {
    if (!this.configurationManager) {
      return 'origin';
    }

    return resolveGitHubRemoteInteractive(this.git, {
      branch: opts.branch,
      defaultRemote: this.configurationManager.get().defaultRemote,
      purpose: opts.purpose,
      githubRepo: opts.githubRepo,
    });
  }

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

  async abortClonePR(): Promise<void> {
    this.finishProgress?.();
    await this.cleanUp(true);
  }
}
