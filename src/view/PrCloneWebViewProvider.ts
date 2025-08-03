import {
  ExtensionContext,
  WebviewView,
  WebviewViewProvider,
  window,
  commands,
  Uri,
  authentication,
} from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { LoggingService } from '../logging/loggingService';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

interface GitHubPR {
  number: number;
  title: string;
  body: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  html_url: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
  };
  parents: { sha: string }[];
}

export class PrCloneWebViewProvider implements WebviewViewProvider {
  private webviewView?: WebviewView;
  private git?: GitExecutor;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService
  ) {}

  private async getGitHubToken(): Promise<string | undefined> {
    try {
      const session = await authentication.getSession('github', ['repo'], { createIfNone: true });
      return session.accessToken;
    } catch (error) {
      this.loggingService.error(`Failed to get GitHub authentication: ${error}`);
      window.showWarningMessage(
        'GitHub authentication failed. Some features may not work properly.'
      );
      return undefined;
    }
  }

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
        case 'fetchPR':
          await this.handleFetchPR(message.prInput);
          break;
        case 'clonePR':
          await this.handleClonePR(message.data);
          break;
        case 'selectTargetBranch':
          await this.handleSelectTargetBranch(message.branches);
          break;
        case 'cancelPRClone':
          await this.handleCancelPRClone();
          break;
      }
    });
  }

  private async initGit(): Promise<GitExecutor> {
    if (!this.git) {
      const { workspace } = await import('vscode');
      const workspaceFolders = workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder found');
      }
      this.git = new GitExecutor(workspaceFolders[0].uri.fsPath, this.loggingService);
    }
    return this.git;
  }

  private async handleFetchPR(prInput: string) {
    try {
      const git = await this.initGit();
      const prNumber = this.extractPRNumber(prInput);
      const repoInfo = await this.getRepoInfo(git);

      if (!repoInfo) {
        throw new Error('Could not determine GitHub repository information');
      }

      const prData = await this.fetchPRData(repoInfo.owner, repoInfo.repo, prNumber);
      const commits = await this.fetchPRCommits(repoInfo.owner, repoInfo.repo, prNumber);
      const branches = await this.getBranches(git);

      this.updateWebviewWithPRData(prData, commits, branches);
    } catch (error) {
      this.loggingService.error(`Failed to fetch PR: ${error}`);
      window.showErrorMessage(
        `Failed to fetch PR: ${error instanceof Error ? error.message : error}`
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

  private async getRepoInfo(git: GitExecutor): Promise<{ owner: string; repo: string } | null> {
    try {
      const remoteUrl = await git.getRemoteUrl();
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    } catch (error) {
      this.loggingService.error(`Failed to get repo info: ${error}`);
    }
    return null;
  }

  private async fetchPRData(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
    const token = await this.getGitHubToken();

    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
      const headers: { [key: string]: string } = {
        'User-Agent': 'git-smart-checkout-vscode-extension',
        Accept: 'application/vnd.github.v3+json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const options = { headers };

      https
        .get(url, options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (error) {
                reject(new Error(`Failed to parse JSON: ${error}`));
              }
            } else {
              reject(new Error(`GitHub API error: ${res.statusCode} ${res.statusMessage}`));
            }
          });
        })
        .on('error', (error) => {
          reject(new Error(`Request error: ${error.message}`));
        });
    });
  }

  private async fetchPRCommits(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubCommit[]> {
    const token = await this.getGitHubToken();

    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits`;
      const headers: { [key: string]: string } = {
        'User-Agent': 'git-smart-checkout-vscode-extension',
        Accept: 'application/vnd.github.v3+json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const options = { headers };

      https
        .get(url, options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (error) {
                reject(new Error(`Failed to parse JSON: ${error}`));
              }
            } else {
              reject(new Error(`GitHub API error: ${res.statusCode} ${res.statusMessage}`));
            }
          });
        })
        .on('error', (error) => {
          reject(new Error(`Request error: ${error.message}`));
        });
    });
  }

  private async getBranches(git: GitExecutor): Promise<string[]> {
    try {
      const refs = await git.getAllRefListExtended(false);
      return refs.filter((ref) => !ref.remote && !ref.isTag).map((ref) => ref.name);
    } catch (error) {
      this.loggingService.error(`Failed to get branches: ${error}`);
      return ['main', 'master', 'develop'];
    }
  }

  private async handleSelectTargetBranch(branches: string[]) {
    try {
      const selectedBranch = await window.showQuickPick(branches, {
        placeHolder: 'Select target branch',
        canPickMany: false
      });

      if (selectedBranch && this.webviewView) {
        this.webviewView.webview.postMessage({
          command: 'targetBranchSelected',
          branch: selectedBranch
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

    this.webviewView.webview.postMessage({
      command: 'showPRData',
      prData,
      commits,
      branches,
    });
  }

  private async handleClonePR(data: any) {
    try {
      const git = await this.initGit();

      await window.withProgress(
        {
          location: { viewId: 'git-smart-checkout.prClone' },
          title: 'Cloning PR',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating feature branch...' });
          await git.createBranch(data.featureBranch, data.targetBranch);
          await git.checkout(data.featureBranch);

          progress.report({ message: 'Cherry-picking commits...' });
          for (const commitSha of data.selectedCommits) {
            await git.cherryPick(commitSha);
          }

          progress.report({ message: 'Creating PR...' });
          await this.createPR(data.targetBranch, data.featureBranch, data.description);
        }
      );

      window.showInformationMessage('PR cloned successfully!');
    } catch (error) {
      this.loggingService.error(`Failed to clone PR: ${error}`);
      window.showErrorMessage(
        `Failed to clone PR: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async handleCancelPRClone() {
    // Hide the PR Clone view by clearing the context
    await commands.executeCommand('setContext', 'git-smart-checkout.showPrClone', false);
  }

  private async createPR(targetBranch: string, featureBranch: string, description: string) {
    const git = await this.initGit();
    const repoInfo = await this.getRepoInfo(git);

    if (!repoInfo) {
      throw new Error('Could not determine repository information');
    }

    await commands.executeCommand('git.push');

    const prUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/compare/${targetBranch}...${featureBranch}?expand=1&body=${encodeURIComponent(description)}`;
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
}
