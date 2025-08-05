import {
  ExtensionContext,
  WebviewView,
  WebviewViewProvider,
  window,
  commands,
  Uri,
  ExtensionMode,
} from 'vscode';
import { LoggingService } from '../logging/loggingService';
import * as path from 'path';
import * as fs from 'fs';
import { GitHubCommit } from '../types/dataTypes';

export class PrCommitsWebViewProvider implements WebviewViewProvider {
  private webviewView?: WebviewView;
  private commits: GitHubCommit[] = [];
  private selectedCommits: string[] = [];

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService
  ) {}

  resolveWebviewView(webviewView: WebviewView) {
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
      switch (message.command) {
        case 'commitToggle':
          this.handleCommitToggle(message.sha);
          break;
        case 'getSelectedCommits':
          this.sendSelectedCommits();
          break;
      }
    });
  }

  public updateCommits(commits: GitHubCommit[]) {
    this.commits = commits;
    // Auto-select non-merge commits
    this.selectedCommits = commits
      .filter(commit => commit.parents.length <= 1)
      .map(commit => commit.sha);
    
    this.updateWebviewWithCommits();
    this.sendSelectedCommits();
  }

  private handleCommitToggle(sha: string) {
    if (this.selectedCommits.includes(sha)) {
      this.selectedCommits = this.selectedCommits.filter(s => s !== sha);
    } else {
      this.selectedCommits = [...this.selectedCommits, sha];
    }
    this.sendSelectedCommits();
  }

  private sendSelectedCommits() {
    // Send selected commits to main webview
    commands.executeCommand('git-smart-checkout.updateSelectedCommits', this.selectedCommits);
  }

  public getSelectedCommits(): string[] {
    return this.selectedCommits;
  }

  private updateWebviewWithCommits() {
    if (!this.webviewView) {
      return;
    }

    const commitData = this.commits.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message.split('\n')[0],
      isMergeCommit: commit.parents.length > 1
    }));

    this.webviewView.webview.postMessage({
      command: 'updateCommits',
      commits: commitData,
      selectedCommits: this.selectedCommits,
    });
  }

  private getReactHtml(webview: any, extensionUri: Uri): string {
    // Always serve from built files (both dev and production use watch-webview)
    return this.getProductionHtml(webview, extensionUri);
  }


  private getProductionHtml(webview: any, extensionUri: Uri): string {
    // Path to the built webview
    const webviewDistPath = Uri.joinPath(extensionUri, 'dist', 'webview').fsPath;
    const indexHtmlPath = path.join(webviewDistPath, 'commits.html');

    try {
      // Read the built HTML file
      let html = fs.readFileSync(indexHtmlPath, 'utf8');

      // Replace root div id for commits webview
      html = html.replace('<div id="root">', '<div id="commits-root">');

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
          <div id="commits-root">
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
}