import * as fs from 'fs';
import * as path from 'path';
import { commands, ExtensionContext, Uri, WebviewView, WebviewViewProvider, window } from 'vscode';

import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { ConfigurationManager } from '../configuration/configurationManager';
import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { PrCloneData, PrCloneService } from '../services/prCloneService';
import { GitHubCommit, GitHubPR } from '../types/dataTypes';
import { WebviewCommand } from '../types/webviewCommands';
import { PrCommitsWebViewProvider } from './PrCommitsWebViewProvider';
import {
  setContextIsCloning,
  setContextShowPRClone,
  setContextShowPRCommits,
} from '../utils/setContext';

export class PrCloneWebViewProvider implements WebviewViewProvider {
  private webviewView?: WebviewView;
  private commitsProvider?: PrCommitsWebViewProvider;
  private currentPrData?: GitHubPR;

  private git?: GitExecutor;
  private ghClient?: GitHubClient;

  private cloneServiceCleanUpAssigned = false;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService,
    private configurationManager: ConfigurationManager,
    private prCloneService: PrCloneService
  ) {}

  resolveWebviewView(webviewView: WebviewView) {
    this.loggingService.info('...Resolve webview');
    this.webviewView = webviewView;

    this.git = this.prCloneService.git;
    this.ghClient = this.prCloneService.ghClient;

    const extensionUri = this.context.extensionUri;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(extensionUri, 'dist'),
        Uri.joinPath(extensionUri, 'src', 'webview'),
      ],
    };

    if (!this.cloneServiceCleanUpAssigned) {
      // register clean up actions
      this.prCloneService.addCleanUpActions({
        cleanUpActionEnd: () => {
          webviewView.webview.postMessage({
            command: WebviewCommand.UPDATE_CLONING_STATE,
            isCloning: false,
          });

          this.updateCloningState(false);

          webviewView.webview.postMessage({
            command: WebviewCommand.CANCEL_PR_CLONE,
          });
        },
      });

      this.cloneServiceCleanUpAssigned = true;
    }

    webviewView.webview.html = this.getReactHtml(webviewView.webview, extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log(`[<<<< ]: received command: ${JSON.stringify(message)}`);
      switch (message.command) {
        case WebviewCommand.WEBVIEW_READY:
          await this.handleWebViewReady();
          break;
        case WebviewCommand.FETCH_PR:
          await this.handleFetchPR(message.prInput);
          break;
        case WebviewCommand.CLONE_PR:
          await this.handleClonePR(message.data);
          break;
        case WebviewCommand.SELECT_TARGET_BRANCH:
          await this.handleSelectTargetBranch(message.branches);
          break;
        case WebviewCommand.CANCEL_PR_CLONE:
          await this.handleCancelPRClone();
          break;
        case WebviewCommand.HIDE_COMMITS_WEBVIEW:
          await this.handleHideCommitsWebview();
          break;
        case WebviewCommand.SHOW_NOTIFICATION:
          await this.handleShowNotification(message.message, message.type, message.items);
          break;
        case WebviewCommand.LOG:
          this.handleWebviewLog(message.level, message.message);
          break;
        case WebviewCommand.SHOW_CONFIRMATION_DIALOG:
          await this.handleShowConfirmationDialog(message.message, message.details, message.data);
          break;
      }
    });
  }

  private async handleWebViewReady() {
    if (!this.webviewView) {
      return;
    }

    const repoInfo = {
      repo: this.ghClient?.repo,
      owner: this.ghClient?.owner,
    };

    this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_REPO_INFO,
      repoInfo,
    });
  }

  private async handleFetchPR(prInput: string) {
    if (!this.git || !this.ghClient) {
      throw new Error('Git client is not initialized');
    }

    try {
      const prNumber = this.extractPRNumber(prInput);

      const prData = await this.ghClient.fetchPullRequest(prNumber);
      this.currentPrData = prData; // Store PR data for later use

      // Fetch the latest changes for the PR's specific branch
      this.loggingService.info(`Fetching latest changes for PR branch: ${prData.head.ref}`);
      try {
        await this.git.fetchSpecificBranch(prData.head.ref);
        this.loggingService.info(
          `Successfully fetched latest changes for branch: ${prData.head.ref}`
        );
      } catch (fetchError) {
        this.loggingService.warn(
          `Failed to fetch latest changes for branch ${prData.head.ref}: ${fetchError}`
        );
        // Continue with PR fetching even if fetch fails
      }

      const commits = await this.ghClient.fetchPullRequestCommits(prNumber);

      // Fetch detailed information for each commit including files
      const detailedCommits = await this.ghClient.fetchCommitsDetails(commits);

      const branches = await this.getBranches(this.git);

      this.updateWebviewWithPRData(prData, detailedCommits, branches);
    } catch (error) {
      this.loggingService.error(`Failed to fetch PR: ${error}`);
      await window.showErrorMessage(
        `Failed to fetch PR: ${error instanceof Error ? error.message : error}`,
        'OK'
      );
    }
  }

  private extractPRNumber(input: string): number {
    const prNumberMatch = input.match(/(?:pull\/|#)(\d+)/);
    if (prNumberMatch) {
      return parseInt(prNumberMatch[1], 10);
    }

    const numberMatch = input.match(/^\d+$/);
    if (numberMatch) {
      return parseInt(input, 10);
    }

    throw new Error('Invalid PR number or URL format');
  }

  private async getBranches(git: GitExecutor): Promise<string[]> {
    const refs = await git.getAllRefListExtended(false);
    return refs.filter((ref) => !ref.remote && !ref.isTag).map((ref) => ref.name);
  }

  private async handleSelectTargetBranch(branches: string[]) {
    try {
      const selectedBranch = await window.showQuickPick(branches, {
        placeHolder: 'Select target branch',
        canPickMany: false,
      });

      if (selectedBranch && this.webviewView) {
        this.webviewView.webview.postMessage({
          command: WebviewCommand.TARGET_BRANCH_SELECTED,
          branch: selectedBranch,
        });
      }
    } catch (error) {
      this.loggingService.error(`Failed to select target branch: ${error}`);
    }
  }

  private updateWebviewWithPRData(prData: GitHubPR, commits: GitHubCommit[], branches: string[]) {
    if (!this.webviewView) {
      return;
    }

    // Get default target branch from configuration
    const config = this.configurationManager.get();
    const defaultTargetBranch = config.defaultTargetBranch || 'main';

    // Validate that the default target branch exists in available branches
    if (
      defaultTargetBranch &&
      defaultTargetBranch.trim() &&
      !branches.includes(defaultTargetBranch)
    ) {
      this.handleInvalidDefaultBranch(defaultTargetBranch, branches);
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.SHOW_PR_DATA,
      prData,
      commits,
      branches,
      defaultTargetBranch,
    });

    // Also update the commits webview
    if (this.commitsProvider) {
      this.commitsProvider.updateCommits(commits);
    }

    // Show the commits webview now that PR data is loaded
    setContextShowPRCommits(true);
  }

  public setCommitsProvider(commitsProvider: PrCommitsWebViewProvider) {
    this.commitsProvider = commitsProvider;
  }

  public updateSelectedCommits(selectedCommits: string[]) {
    this.loggingService.debug('selectedCommits', selectedCommits);
    if (!this.webviewView) {
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_SELECTED_COMMITS,
      selectedCommits,
    });
  }

  public clearState() {
    if (!this.webviewView) {
      return;
    }

    this.loggingService.info('...clear state command invoked...');

    // Hide the commits webview
    setContextShowPRCommits(false);

    // Clear commits data from the webview provider
    if (this.commitsProvider) {
      this.commitsProvider.clearState();
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.CLEAR_STATE,
    });
  }

  private async handleClonePR(data: any) {
    try {
      // Set loading state
      this.updateCloningState(true);

      if (!this.prCloneService || !this.currentPrData) {
        throw new Error('PR Clone service or PR data not initialized');
      }

      // Prepare the data for the PR clone service
      const prCloneData: PrCloneData = {
        prData: this.currentPrData,
        targetBranch: data.targetBranch,
        featureBranch: data.featureBranch,
        description: data.description,
        selectedCommits: data.selectedCommits,
        isDraft: data.isDraft || false,
      };

      // Use the new PrCloneService to handle the complex workflow
      await this.prCloneService.clonePR(prCloneData);
    } catch (error) {
      this.loggingService.error(`Failed to clone PR: ${error}`);
      window.showErrorMessage(
        `Failed to clone PR: ${error instanceof Error ? error.message : error}`
      );
    }

    //todo: use updateLoadingState(false) in another method that finalizes or cancels current pr clone process
    // finally {
    //   // Clear loading state
    //   this.updateLoadingState(false);
    // }
  }

  private async handleCancelPRClone() {
    // Hide both PR Clone view and commits view by clearing the context
    await setContextShowPRClone(false);
    await setContextShowPRCommits(false);
  }

  private async handleHideCommitsWebview() {
    // Hide only the commits webview
    await setContextShowPRCommits(false);
  }

  private async handleShowNotification(
    message: string,
    type: 'info' | 'warn' | 'error' = 'info',
    items: string[] = []
  ) {
    // Show notification using VS Code's notification system with OK button to make them dismissible

    switch (type) {
      case 'info':
        return window.showInformationMessage(message, ...items);
      case 'warn':
        return window.showWarningMessage(message, ...items);
      case 'error':
        return window.showErrorMessage(message, ...items);
    }
  }

  private async handleInvalidDefaultBranch(
    defaultTargetBranch: string,
    availableBranches: string[]
  ) {
    this.loggingService.error(
      `Default target branch '${defaultTargetBranch}' does not exist in available branches: ${availableBranches.join(', ')}`
    );

    // Hide the activity bar and webviews
    await setContextShowPRClone(false);
    await setContextShowPRCommits(false);

    // Show dismissible error notification with settings button
    const openSettingsAction = 'Open Settings';
    const selectedAction = await window.showErrorMessage(
      `Default target branch '${defaultTargetBranch}' does not exist in your repository. Available branches: ${availableBranches.join(', ')}. Please update the extension settings.`,
      openSettingsAction
    );

    if (selectedAction === openSettingsAction) {
      // Open extension settings
      await commands.executeCommand(
        'workbench.action.openSettings',
        `${EXTENSION_NAME}.defaultTargetBranch`
      );
    }
  }

  private updateCloningState(isCloning: boolean) {
    if (!this.webviewView) {
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_CLONING_STATE,
      isCloning,
    });

    // Update commits webview cloning state
    if (this.commitsProvider) {
      this.commitsProvider.updateCloningState(isCloning);
    }

    // Update context to disable/enable interactions
    setContextIsCloning(isCloning);
  }

  private async handleShowConfirmationDialog(message: string, details: string, data: any) {
    const confirmAction = 'Proceed';

    const selectedAction = await window.showInformationMessage(
      message,
      { modal: true, detail: details },
      confirmAction
    );

    if (selectedAction === confirmAction) {
      await this.handleClonePR(data);
    }
  }

  private handleWebviewLog(level: 'info' | 'warn' | 'error' | 'debug', message: string) {
    // Forward webview log messages to extension logging service
    const logMessage = `[WebView] ${message}`;
    console.log('Message to log: ', message);

    switch (level) {
      case 'error':
        this.loggingService.error(logMessage);
        break;
      case 'warn':
        this.loggingService.warn(logMessage);
        break;
      case 'debug':
        this.loggingService.debug(logMessage);
        break;
      case 'info':
      default:
        this.loggingService.info(logMessage);
        break;
    }
  }

  private async createPR(targetBranch: string, featureBranch: string, description: string) {
    if (!this.ghClient) {
      throw new Error('GitHub client not initialized');
    }

    await commands.executeCommand('git.push');

    const prUrl = this.ghClient.createPullRequestUrl(targetBranch, featureBranch, description);
    await commands.executeCommand('vscode.open', prUrl);
  }

  private getReactHtml(webview: any, extensionUri: Uri): string {
    // Path to the built webview
    const webviewDistPath = Uri.joinPath(extensionUri, 'dist', 'webview').fsPath;
    const indexHtmlPath = path.join(webviewDistPath, 'index.html');

    try {
      // Read the built HTML file
      let html = fs.readFileSync(indexHtmlPath, 'utf8');

      // Replace asset paths with webview URIs
      html = html.replace(/(href|src)="([^"]+)"/g, (match, attr, assetPath) => {
        if (assetPath.startsWith('/') || assetPath.startsWith('http')) {
          return match;
        }
        const assetUri = webview.asWebviewUri(
          Uri.joinPath(extensionUri, 'dist', 'webview', assetPath)
        );
        return `${attr}="${assetUri}"`;
      });

      // Update CSP to allow the webview resources
      html = html.replace(
        /content="[^"]*"/,
        `content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';"`
      );

      return html;
    } catch (error) {
      this.loggingService.error(`Failed to load built webview: ${error}`);

      const errorMessage = error instanceof Error ? error.message : 'Unknown Error';

      // Fallback to simple HTML if build is not available
      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PR Clone</title>
          <style>
            body {
              font-family: var(--vscode-font-family);
              color: var(--vscode-foreground);
              background-color: var(--vscode-editor-background);
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <div id="root">
            <h2>PR Clone</h2>
            <p>Please build the webview first by running: <code>yarn build-webview</code></p>
            <p>Error: ${errorMessage}</p>
          </div>
          <script>
            window.vscode = acquireVsCodeApi();
          </script>
        </body>
        </html>
      `;
    }
  }

  dispose(): void {
    if (this.prCloneService) {
      this.prCloneService.dispose();
    }
  }
}
