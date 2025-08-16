import * as fs from 'fs';
import * as path from 'path';
import { commands, env, ExtensionContext, Uri, WebviewView, WebviewViewProvider } from 'vscode';

import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { GitHubCommit } from '../types/dataTypes';
import { WebviewCommand } from '../types/webviewCommands';

export class PrCommitsWebViewProvider implements WebviewViewProvider {
  private webviewView?: WebviewView;
  private commits: GitHubCommit[] = [];
  private selectedCommits: string[] = [];
  private static readonly STORAGE_KEY = 'pr-commits-webview-state';
  private isCloning: boolean = false;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService
  ) {
    this.loadPersistedState();
  }

  private loadPersistedState() {
    try {
      const workspaceState = this.context.workspaceState;
      const savedState = workspaceState.get<{commits: GitHubCommit[], selectedCommits: string[]}>(PrCommitsWebViewProvider.STORAGE_KEY);
      
      if (savedState) {
        this.commits = savedState.commits || [];
        this.selectedCommits = savedState.selectedCommits || [];
      }
    } catch (error) {
      this.loggingService.warn(`Failed to load persisted commits state: ${error}`);
    }
  }

  private savePersistedState() {
    try {
      const workspaceState = this.context.workspaceState;
      const stateToSave = {
        commits: this.commits,
        selectedCommits: this.selectedCommits
      };
      workspaceState.update(PrCommitsWebViewProvider.STORAGE_KEY, stateToSave);
    } catch (error) {
      this.loggingService.warn(`Failed to save commits state: ${error}`);
    }
  }

  resolveWebviewView(webviewView: WebviewView) {
    this.loggingService.info('...Resolve commits webview');
    this.webviewView = webviewView;

    const extensionUri = this.context.extensionUri;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(extensionUri, 'dist'),
        Uri.joinPath(extensionUri, 'src', 'webview'),
      ],
    };

    webviewView.webview.html = this.getReactHtml(webviewView.webview, extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      this.loggingService.debug(`[CommitsWebView] received command: ${JSON.stringify(message)}`);
      
      switch (message.command) {
        case WebviewCommand.TOGGLE_COMMIT:
          await this.handleToggleCommit(message.sha);
          break;
        case WebviewCommand.SELECT_ALL_COMMITS:
          await this.handleSelectAllCommits();
          break;
        case WebviewCommand.DESELECT_ALL_COMMITS:
          await this.handleDeselectAllCommits();
          break;
        case WebviewCommand.COPY_COMMITS_TO_CLIPBOARD:
          await this.handleCopyCommitsToClipboard();
          break;
        case WebviewCommand.WEBVIEW_READY:
          // Webview is ready, send current state to restore previous selection
          this.loggingService.debug('Webview ready, sending current state for restoration');
          this.sendCommitsToWebview();
          break;
        case WebviewCommand.LOG:
          this.handleWebviewLog(message.level, message.message);
          break;
      }
    });

    // Handle webview visibility changes - restore state when becoming visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.loggingService.debug('Commits webview became visible, restoring persisted state');
        // Load persisted state first in case it was updated
        this.loadPersistedState();
        // Send current state to restore previous selection (not a user interaction)
        this.sendCommitsToWebview();
      }
    });

    // Send initial data if available
    if (this.commits.length > 0) {
      this.sendCommitsToWebview();
    }
  }

  public updateCommits(commits: GitHubCommit[]) {
    this.commits = commits;
    this.loggingService.debug("Commits: ", commits);
    
    // Auto-select non-merge commits (unselect merge commits by default)
    this.selectedCommits = commits
      .filter(commit => commit.parents.length <= 1) // Only non-merge commits
      .map(commit => commit.sha);
    
    this.savePersistedState();
    this.sendCommitsToWebview();
    this.sendSelectedCommitsToMainWebview();
  }

  private async handleToggleCommit(sha: string) {
    if (this.isCloning) {
      this.loggingService.warn('Cannot toggle commit during cloning process');
      return;
    }

    this.loggingService.info(`Toggling commit selection: ${sha}`);
    
    if (this.selectedCommits.includes(sha)) {
      this.selectedCommits = this.selectedCommits.filter(s => s !== sha);
    } else {
      this.selectedCommits = [...this.selectedCommits, sha];
    }
    
    this.savePersistedState();
    // Send updated commits due to user checkbox toggle
    this.sendCommitsToWebview();
    this.sendSelectedCommitsToMainWebview();
  }

  private async handleSelectAllCommits() {
    if (this.isCloning) {
      this.loggingService.warn('Cannot select all commits during cloning process');
      return;
    }

    this.loggingService.info('Selecting all commits');
    this.selectedCommits = this.commits.map(commit => commit.sha);
    this.savePersistedState();
    // Send updated commits due to "Select All" button press
    this.sendCommitsToWebview();
    this.sendSelectedCommitsToMainWebview();
  }

  private async handleDeselectAllCommits() {
    if (this.isCloning) {
      this.loggingService.warn('Cannot deselect all commits during cloning process');
      return;
    }

    this.loggingService.info('Deselecting all commits');
    this.selectedCommits = [];
    this.savePersistedState();
    // Send updated commits due to "Unselect All" button press
    this.sendCommitsToWebview();
    this.sendSelectedCommitsToMainWebview();
  }

  private async handleCopyCommitsToClipboard() {
    this.loggingService.info('Copying commits to clipboard');
    
    try {
      if (this.commits.length === 0) {
        await commands.executeCommand('git-smart-checkout.showNotification', 'No commits available to copy', 'info');
        return;
      }

      const commitLines = this.commits.map((commit: GitHubCommit) => {
        const isBackMerge = commit.parents.length > 1;
        const prefix = isBackMerge ? 'B' : 'C';
        const description = commit.commit.message.split('\n')[0];
        return `${prefix}: ${commit.sha} - ${description}`;
      });

      const clipboardContent = commitLines.join('\n');
      await env.clipboard.writeText(clipboardContent);

      await commands.executeCommand('git-smart-checkout.showNotification', 
        `Copied ${this.commits.length} commits to clipboard`, 'info');
      
      this.loggingService.info(`Copied ${this.commits.length} commits to clipboard`);
    } catch (error) {
      this.loggingService.error(`Failed to copy commits to clipboard: ${error}`);
      await commands.executeCommand('git-smart-checkout.showNotification', 
        `Failed to copy commits to clipboard: ${error}`, 'error');
    }
  }

  private sendCommitsToWebview() {
    if (!this.webviewView || !this.webviewView.visible) {
      this.loggingService.debug('Webview not available or not visible, skipping state update');
      return;
    }

    this.loggingService.debug(`Sending commits to webview: ${this.commits.length} commits, ${this.selectedCommits.length} selected`);
    
    try {
      this.webviewView.webview.postMessage({
        command: WebviewCommand.UPDATE_COMMITS,
        commits: this.commits,
        selectedCommits: this.selectedCommits,
        isCloning: this.isCloning
      });
    } catch (error) {
      this.loggingService.warn(`Failed to send commits to webview: ${error}`);
    }
  }

  private sendSelectedCommitsToMainWebview() {
    // Send selected commits to main webview
    commands.executeCommand(`${EXTENSION_NAME}.updateSelectedCommits`, this.selectedCommits);
  }

  public getSelectedCommits(): string[] {
    return this.selectedCommits;
  }

  public getCommits(): GitHubCommit[] {
    return this.commits;
  }

  public updateLoadingState(isCloning: boolean) {
    this.isCloning = isCloning;
    this.sendCommitsToWebview();
  }

  public clearState() {
    this.loggingService.info('Clearing commits webview state');
    this.commits = [];
    this.selectedCommits = [];
    this.savePersistedState();
    this.sendCommitsToWebview();
  }

  private handleWebviewLog(level: 'info' | 'warn' | 'error' | 'debug', message: string) {
    // Forward webview log messages to extension logging service
    const logMessage = `[CommitsWebView] ${message}`;
    
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

  private getReactHtml(webview: any, extensionUri: Uri): string {
    // Path to the built webview
    const webviewDistPath = Uri.joinPath(extensionUri, 'dist', 'webview').fsPath;
    const commitsHtmlPath = path.join(webviewDistPath, 'commits.html');

    try {
      // Read the built HTML file
      let html = fs.readFileSync(commitsHtmlPath, 'utf8');

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
      this.loggingService.error(`Failed to load built commits webview: ${error}`);

      const errorMessage = error instanceof Error ? error.message : 'Unknown Error';

      // Fallback to simple HTML if build is not available
      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PR Commits</title>
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
            <h2>PR Commits</h2>
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
    // Clean up resources if needed
  }
}