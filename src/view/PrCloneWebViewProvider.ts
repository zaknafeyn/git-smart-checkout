import * as fs from 'fs';
import * as path from 'path';
import {
  commands,
  Disposable,
  ExtensionContext,
  Uri,
  type Webview,
  WebviewView,
  WebviewViewProvider,
  window,
} from 'vscode';

import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { ConfigurationManager } from '../configuration/configurationManager';
import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { PrCloneData, PrCloneService } from '../services/prCloneService';
import { PrCloneReportedError } from '../services/prCloneError';
import { GitHubCommit, GitHubPR } from '../types/dataTypes';
import { WebviewCommand } from '../types/webviewCommands';
import { orderSelectedCommits } from '../utils/commitOrder';
import { getNonce } from '../utils/getNonce';
import { PrCommitsWebViewProvider } from './PrCommitsWebViewProvider';
import {
  setContextIsCloning,
  setContextShowPRClone,
  setContextShowPRCommits,
} from '../utils/setContext';
import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../commands/utils/parsePRInput';

export function postFetchPRError(
  webview: Pick<Webview, 'postMessage'> | undefined,
  error: unknown
): Thenable<boolean> | undefined {
  return webview?.postMessage({
    command: WebviewCommand.FETCH_PR_ERROR,
    message: String(error),
  });
}

export class PrCloneWebViewProvider implements WebviewViewProvider {
  private webviewView?: WebviewView;
  private commitsProvider?: PrCommitsWebViewProvider;
  private currentPrData?: GitHubPR;
  private currentCommits: GitHubCommit[] = [];

  private cloneServiceCleanUpAssigned = false;
  private readonly repositoryChangeSubscription: Disposable;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService,
    private configurationManager: ConfigurationManager,
    private prCloneService: PrCloneService
  ) {
    this.repositoryChangeSubscription = this.prCloneService.onDidChangeRepository(() => {
      this.clearState();
      this.updateRepoInfo();
    });
  }

  resolveWebviewView(webviewView: WebviewView) {
    this.loggingService.info('...Resolve webview');
    this.webviewView = webviewView;

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
        cleanUpActionEnd: async () => {
          await webviewView.webview.postMessage({
            command: WebviewCommand.UPDATE_CLONING_STATE,
            isCloning: false,
          });

          await this.updateCloningState(false);

          await webviewView.webview.postMessage({
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
    this.updateRepoInfo();
  }

  private updateRepoInfo() {
    if (!this.webviewView) {
      return;
    }

    const repoInfo = {
      repo: this.prCloneService.ghClient.repo,
      owner: this.prCloneService.ghClient.owner,
    };

    this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_REPO_INFO,
      repoInfo,
    });
  }

  private async handleFetchPR(prInput: string) {
    try {
      const git = this.prCloneService.git;
      const ghClient = this.prCloneService.ghClient;
      const parsedInput = parsePRInput(prInput);
      if (!parsedInput) {
        await postFetchPRError(this.webviewView?.webview, INVALID_PR_INPUT_MESSAGE);
        await window.showErrorMessage(INVALID_PR_INPUT_MESSAGE, 'OK');
        return;
      }

      const repositoryMismatchMessage = getRepositoryMismatchMessage(parsedInput, {
        owner: ghClient.owner,
        repo: ghClient.repo,
      });
      if (repositoryMismatchMessage) {
        await postFetchPRError(this.webviewView?.webview, repositoryMismatchMessage);
        await window.showErrorMessage(repositoryMismatchMessage, 'OK');
        return;
      }

      const { prNumber } = parsedInput;
      const prData = await ghClient.fetchPullRequest(prNumber);
      this.currentPrData = prData; // Store PR data for later use

      // Fetch the latest changes for the PR's specific branch
      this.loggingService.info(`Fetching latest changes for PR branch: ${prData.head.ref}`);
      try {
        await git.fetchSpecificBranch(prData.head.ref);
        this.loggingService.info(
          `Successfully fetched latest changes for branch: ${prData.head.ref}`
        );
      } catch (fetchError) {
        this.loggingService.warn(
          `Failed to fetch latest changes for branch ${prData.head.ref}: ${fetchError}`
        );
        // Continue with PR fetching even if fetch fails
      }

      // GitHub's list-commits endpoint caps at 250 commits. If the PR reports
      // more than that, the commit list (and therefore the clone) is incomplete.
      if (prData.commits !== undefined && prData.commits > GitHubClient.MAX_PR_COMMITS) {
        const warning = `PR #${prNumber} has ${prData.commits} commits, but GitHub only exposes the first ${GitHubClient.MAX_PR_COMMITS}. This PR is too large to clone fully.`;
        this.loggingService.warn(warning);
        await window.showWarningMessage(warning, 'OK');
      }

      const commits = await ghClient.fetchPullRequestCommits(prNumber);

      // Fetch detailed information for each commit including files
      const detailedCommits = await ghClient.fetchCommitsDetails(commits);

      const branches = await this.getBranches(git);

      // Best-effort: pre-fill the description from the repo's PR template when
      // the source PR has no body. A missing template (or fetch failure) must
      // not block the clone flow.
      let prTemplate: string | undefined;
      try {
        prTemplate = await ghClient.fetchPullRequestTemplate();
      } catch (templateError) {
        this.loggingService.warn(`Failed to fetch PR template: ${templateError}`);
      }

      this.updateWebviewWithPRData(prData, detailedCommits, branches, prTemplate);
    } catch (error) {
      this.loggingService.error(`Failed to fetch PR: ${error}`);
      await postFetchPRError(this.webviewView?.webview, error);
      await window.showErrorMessage(
        `Failed to fetch PR: ${error instanceof Error ? error.message : error}`,
        'OK'
      );
    }
  }

  private async getBranches(git: GitExecutor): Promise<string[]> {
    const refs = await git.getAllRefListExtended();
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

  private updateWebviewWithPRData(
    prData: GitHubPR,
    commits: GitHubCommit[],
    branches: string[],
    prTemplate?: string
  ) {
    this.currentCommits = commits;

    if (!this.webviewView) {
      return;
    }

    // Get default target branch and PR branch prefix from configuration
    const config = this.configurationManager.get();
    const defaultTargetBranch = config.defaultTargetBranch || 'main';
    const prBranchPrefix = config.prBranchPrefix || '';

    // Validate that the default target branch exists in available branches
    if (
      defaultTargetBranch &&
      defaultTargetBranch.trim() &&
      !branches.includes(defaultTargetBranch)
    ) {
      this.handleInvalidDefaultBranch(defaultTargetBranch);
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.SHOW_PR_DATA,
      prData,
      commits,
      branches,
      defaultTargetBranch,
      prBranchPrefix,
      prTemplate,
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
    const orderedSelectedCommits = orderSelectedCommits(this.currentCommits, selectedCommits);
    this.loggingService.debug('selectedCommits', orderedSelectedCommits);
    if (!this.webviewView) {
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_SELECTED_COMMITS,
      selectedCommits: orderedSelectedCommits,
    });
  }

  public clearState() {
    this.currentCommits = [];
    this.currentPrData = undefined;

    this.loggingService.info('...clear state command invoked...');

    // Hide the commits webview
    setContextShowPRCommits(false);

    // Clear commits data from the webview provider
    if (this.commitsProvider) {
      this.commitsProvider.clearState();
    }

    if (!this.webviewView) {
      return;
    }

    this.webviewView.webview.postMessage({
      command: WebviewCommand.CLEAR_STATE,
    });
  }

  private async handleClonePR(data: any) {
    try {
      // Set loading state
      await this.updateCloningState(true);

      if (!this.prCloneService || !this.currentPrData) {
        throw new Error('PR Clone service or PR data not initialized');
      }

      // Prepare the data for the PR clone service
      const prCloneData: PrCloneData = {
        prData: this.currentPrData,
        targetBranch: data.targetBranch,
        featureBranch: data.featureBranch,
        description: data.description,
        selectedCommits: orderSelectedCommits(this.currentCommits, data.selectedCommits),
        isDraft: data.isDraft || false,
      };

      // Use the new PrCloneService to handle the complex workflow
      await this.prCloneService.clonePR(prCloneData);
    } catch (error) {
      this.loggingService.error(`Failed to clone PR: ${error}`);
      await this.updateCloningState(false);
      if (!(error instanceof PrCloneReportedError)) {
        await window.showErrorMessage(
          `Failed to clone PR: ${error instanceof Error ? error.message : error}`
        );
      }
    }
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

  private async handleInvalidDefaultBranch(defaultTargetBranch: string) {
    const errorMessage = `Default target branch '${defaultTargetBranch}' does not exist in your repository. Please update the extension settings.`;
    this.loggingService.error(errorMessage);

    // Hide the activity bar and webviews
    await setContextShowPRClone(false);
    await setContextShowPRCommits(false);

    // Show dismissible error notification with settings button
    const openSettingsAction = 'Open Settings';
    const selectedAction = await window.showErrorMessage(errorMessage, openSettingsAction);

    if (selectedAction === openSettingsAction) {
      // Open extension settings
      await commands.executeCommand(
        'workbench.action.openSettings',
        `${EXTENSION_NAME}.defaultTargetBranch`
      );
    }
  }

  private async updateCloningState(isCloning: boolean): Promise<void> {
    if (!this.webviewView) {
      return;
    }

    await this.webviewView.webview.postMessage({
      command: WebviewCommand.UPDATE_CLONING_STATE,
      isCloning,
    });

    // Update commits webview cloning state
    if (this.commitsProvider) {
      this.commitsProvider.updateCloningState(isCloning);
    }

    // Update context to disable/enable interactions
    await setContextIsCloning(isCloning);
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
    await commands.executeCommand('git.push');

    const prUrl = this.prCloneService.ghClient.createPullRequestUrl(
      targetBranch,
      featureBranch,
      description
    );
    await commands.executeCommand('vscode.open', prUrl);
  }

  private getReactHtml(webview: any, extensionUri: Uri): string {
    // Path to the built webview
    const webviewDistPath = Uri.joinPath(extensionUri, 'dist', 'webview').fsPath;
    const indexHtmlPath = path.join(webviewDistPath, 'index.html');

    try {
      // Read the built HTML file
      let html = fs.readFileSync(indexHtmlPath, 'utf8');

      // Generate a per-load nonce so scripts can be whitelisted without 'unsafe-inline'
      const nonce = getNonce();

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

      // Tag every script with the nonce so the CSP permits it
      html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);

      // Update CSP to allow the webview resources (nonce-based, no 'unsafe-inline' scripts)
      html = html.replace(
        /content="[^"]*"/,
        `content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';"`
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
    this.repositoryChangeSubscription.dispose();
  }
}
