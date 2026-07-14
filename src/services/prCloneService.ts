import { Event, EventEmitter, ExtensionContext, ExtensionMode } from 'vscode';

import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { ConfigurationManager } from '../configuration/configurationManager';
// import { PrCloneTempWorktreeService } from './prCloneTempWorktreeService';
import { PrCloneInPlaceService } from './prCloneInPlaceService';
import { setContextIsCloning } from '../utils/setContext';
import { PrCloneTempWorktreeService } from './prCloneTempWorktreeService';

export interface PrCloneData {
  prData: GitHubPR;
  targetBranch: string;
  featureBranch: string;
  description: string;
  selectedCommits: string[];
  isDraft: boolean;
}

export interface ICleanUpActions {
  cleanUpActionBegin?: () => void | Promise<void>;
  cleanUpActionEnd?: () => void | Promise<void>;
}

export class PrCloneService {
  private _tempWorktreeService?: PrCloneTempWorktreeService;
  private _inPlaceService?: PrCloneInPlaceService;
  private _git?: GitExecutor;
  private _ghClient?: GitHubClient;
  private readonly cleanUpActions: ICleanUpActions[] = [];
  private readonly repositoryChangedEmitter = new EventEmitter<void>();

  private _isInited = false;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService,
    private configurationManager: ConfigurationManager
  ) {}

  //#region properties

  get isInited(): boolean {
    return this._isInited;
  }

  get onDidChangeRepository(): Event<void> {
    return this.repositoryChangedEmitter.event;
  }

  get TempWorktreeService(): PrCloneTempWorktreeService {
    if (!this.isInited || !this._tempWorktreeService) {
      throw new Error(`Getter "TempWorktreeService" is not initialized`);
    }

    return this._tempWorktreeService;
  }

  get InPlaceService(): PrCloneInPlaceService {
    if (!this.isInited || !this._inPlaceService) {
      throw new Error(`Getter "InPlaceService" is not initialized`);
    }

    return this._inPlaceService;
  }

  get git(): GitExecutor {
    if (!this.isInited || !this._git) {
      throw new Error(`Getter "git" is not initialized`);
    }

    return this._git;
  }

  get ghClient(): GitHubClient {
    if (!this.isInited || !this._ghClient) {
      throw new Error(`Getter "ghClient" is not initialized`);
    }

    return this._ghClient;
  }

  //#endregion properties

  init(git: GitExecutor, ghClient: GitHubClient) {
    if (
      this.isInited &&
      this.git.repositoryPath === git.repositoryPath &&
      this.ghClient.owner === ghClient.owner &&
      this.ghClient.repo === ghClient.repo
    ) {
      return;
    }

    this._tempWorktreeService?.dispose();
    this._inPlaceService?.dispose();

    this._git = git;
    this._ghClient = ghClient;
    this._tempWorktreeService = new PrCloneTempWorktreeService(
      git,
      ghClient,
      this.loggingService
    );
    this._inPlaceService = new PrCloneInPlaceService(
      git,
      ghClient,
      this.loggingService,
      this.context.workspaceState
    );

    for (const cleanUpActions of this.cleanUpActions) {
      this._tempWorktreeService.addCleanUpActions(cleanUpActions);
      this._inPlaceService.addCleanUpActions(cleanUpActions);
    }

    this._isInited = true;
    this.repositoryChangedEmitter.fire();
  }

  async clonePR(data: PrCloneData): Promise<void> {
    const config = this.configurationManager.get();

    await setContextIsCloning(true);

    try {
      if (config.useInPlaceCherryPick) {
        await this.InPlaceService.clonePR(data);
      } else {
        await this.TempWorktreeService.clonePR(data);
      }
    } catch (error) {
      await setContextIsCloning(false);
      throw error;
    }
  }

  async cherryPickNext(isContinue = false) {
    const config = this.configurationManager.get();

    if (config.useInPlaceCherryPick) {
      await this.InPlaceService.cherryPickNext(isContinue);
    } else {
      await this.TempWorktreeService.cherryPickNext();
    }
  }

  async abortClonePR() {
    if (!this.isInited) {
      return;
    }

    const config = this.configurationManager.get();

    if (config.useInPlaceCherryPick) {
      await this.InPlaceService.abortClonePR();
    } else {
      await this.TempWorktreeService.abortClonePR();
    }
  }

  isDevMode() {
    return this.context.extensionMode === ExtensionMode.Development;
  }

  addCleanUpActions(cleanUpActions: ICleanUpActions) {
    this.cleanUpActions.push(cleanUpActions);
    this.InPlaceService.addCleanUpActions(cleanUpActions);
    this.TempWorktreeService.addCleanUpActions(cleanUpActions);
  }

  dispose(): void {
    if (this.isInited) {
      this.TempWorktreeService.dispose();
      this.InPlaceService.dispose();
    }

    this.repositoryChangedEmitter.dispose();
  }
}
