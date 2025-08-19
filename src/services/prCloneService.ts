import { ExtensionContext, ExtensionMode } from 'vscode';

import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { ConfigurationManager } from '../configuration/configurationManager';
// import { PrCloneTempWorktreeService } from './prCloneTempWorktreeService';
import { PrCloneInPlaceService } from './prCloneInPlaceService';
import { setContextIsCloning } from '../utils/setContext';

export interface PrCloneData {
  prData: GitHubPR;
  targetBranch: string;
  featureBranch: string;
  description: string;
  selectedCommits: string[];
  isDraft: boolean;
}

export interface ICleanUpActions {
  cleanUpActionBegin?: () => void;
  cleanUpActionEnd?: () => void;
}

export class PrCloneService {
  // todo: uncomment when PrCloneTempWorktreeService is ready
  // private _tempWorktreeService?: PrCloneTempWorktreeService;
  private _inPlaceService?: PrCloneInPlaceService;
  private _git?: GitExecutor;
  private _ghClient?: GitHubClient;

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

  // get TempWorktreeService(): PrCloneTempWorktreeService {
  //   if (!this.isInited || !this._tempWorktreeService) {
  //     throw new Error(`Getter "TempWorktreeService" is not initialized`);
  //   }

  //   return this._tempWorktreeService;
  // }

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
    if (!this.isInited) {
      this._isInited = true;
      this._git = git;
      this._ghClient = ghClient;

      // this._tempWorktreeService = new PrCloneTempWorktreeService(
      //   this.git,
      //   this.ghClient,
      //   this.loggingService
      // );

      this._inPlaceService = new PrCloneInPlaceService(
        this.git,
        this.ghClient,
        this.loggingService
      );
    }
  }

  async clonePR(data: PrCloneData): Promise<void> {
    const config = this.configurationManager.get();

    setContextIsCloning(true);

    if (config.useInPlaceCherryPick) {
      // todo: remove inPlaceService and clean up class
      // await this.inPlaceService.clonePR(data);
      await this.InPlaceService.clonePR(data);
    } else {
      // await this.TempWorktreeService.clonePR(data);
    }
  }

  async cherryPickNext(isContinue = false) {
    const config = this.configurationManager.get();

    if (config.useInPlaceCherryPick) {
      await this.InPlaceService.cherryPickNext(isContinue);
    } else {
      // todo: add cherryPickNext to temp workdir flow
      // await this.TempWorktreeService.clonePR(data);
    }
  }

  async abortClonePR() {
    this.InPlaceService.abortClonePR();
  }

  isDevMode() {
    return this.context.extensionMode === ExtensionMode.Development;
  }

  addCleanUpActions(cleanUpActions: ICleanUpActions) {
    this.InPlaceService.addCleanUpActions(cleanUpActions);
  }

  dispose(): void {
    if (!this.init) {
      return;
    }

    // this.TempWorktreeService.dispose();
  }
}
