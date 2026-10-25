import * as fs from 'fs';
import * as path from 'path';
import {
  commands,
  Disposable,
  env,
  ExtensionContext,
  Uri,
  type Webview,
  WebviewView,
  WebviewViewProvider,
} from 'vscode';

import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { StackView } from '../services/stackModel';
import { WebviewCommand } from '../types/webviewCommands';
import { getNonce } from '../utils/getNonce';
import { buildWebviewHtml } from './webviewHtml';

/**
 * Renders the current branch's PR stack (from `StackService`) and lets the
 * user check out a stack member or open its PR. Data is pushed in via
 * `setStack` — this provider has no git/GitHub access of its own.
 */
export class StackWebViewProvider implements WebviewViewProvider, Disposable {
  private webviewView?: WebviewView;
  private stack?: StackView;
  private static readonly STORAGE_KEY = 'stacks-webview-state';

  constructor(
    private readonly context: ExtensionContext,
    private readonly loggingService: LoggingService,
    private readonly onRefreshRequested: () => void
  ) {
    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    try {
      this.stack = this.context.workspaceState.get<StackView | undefined>(StackWebViewProvider.STORAGE_KEY);
    } catch (error) {
      this.loggingService.warn(`Failed to load persisted stack state: ${error}`);
    }
  }

  private savePersistedState(): void {
    try {
      void this.context.workspaceState.update(StackWebViewProvider.STORAGE_KEY, this.stack);
    } catch (error) {
      this.loggingService.warn(`Failed to save stack state: ${error}`);
    }
  }

  resolveWebviewView(webviewView: WebviewView): void {
    this.loggingService.info('...Resolve stacks webview');
    this.webviewView = webviewView;

    const extensionUri = this.context.extensionUri;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(extensionUri, 'dist'), Uri.joinPath(extensionUri, 'src', 'webview')],
    };

    webviewView.webview.html = this.getReactHtml(webviewView.webview, extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      this.loggingService.debug(`[StacksWebView] received command: ${JSON.stringify(message)}`);

      switch (message.command) {
        case WebviewCommand.WEBVIEW_READY:
          this.postStack();
          break;
        case WebviewCommand.STACK_CHECKOUT_BRANCH:
          await this.handleCheckoutBranch(message.branch);
          break;
        case WebviewCommand.STACK_OPEN_PR:
          await this.handleOpenPr(message.prNumber);
          break;
        case WebviewCommand.STACK_REFRESH:
          this.onRefreshRequested();
          break;
        case WebviewCommand.STACK_FETCH_TARGET:
          await this.handleFetchTarget();
          break;
        case WebviewCommand.LOG:
          this.handleWebviewLog(message.level, message.message);
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.loadPersistedState();
        this.postStack();
      }
    });

    if (this.stack) {
      this.postStack();
    }
  }

  /** Whether the view is currently on screen (resolved, expanded, and not covered by another container). */
  public get isViewVisible(): boolean {
    return this.webviewView?.visible ?? false;
  }

  /**
   * Reveals the view through its own webview handle, without going through the
   * workbench-generated `<viewId>.focus` command. Returns false when the view
   * has never been resolved — a view that has never been on screen has no
   * handle to show. Backs the status bar stack indicator's click (see
   * `revealView`).
   */
  public reveal(preserveFocus = false): boolean {
    if (!this.webviewView) {
      return false;
    }

    this.webviewView.show(preserveFocus);

    return true;
  }

  /** Pushes a freshly-refreshed stack (or `undefined` when not stacked) to the webview. */
  public setStack(view: StackView | undefined): void {
    this.stack = view;
    this.savePersistedState();
    this.postStack();
  }

  private postStack(): void {
    if (!this.webviewView || !this.webviewView.visible) {
      return;
    }
    try {
      this.webviewView.webview.postMessage({
        command: WebviewCommand.UPDATE_STACK,
        view: this.stack,
      });
    } catch (error) {
      this.loggingService.warn(`Failed to send stack to webview: ${error}`);
    }
  }

  private async handleCheckoutBranch(branch: unknown): Promise<void> {
    if (typeof branch !== 'string' || !branch) {
      return;
    }
    await commands.executeCommand(`${EXTENSION_NAME}.checkoutBranch`, {
      branch,
      repositoryPath: this.stack?.repositoryPath,
    });
  }

  /**
   * Fetches the stack's target/base branch from its remote, updating the
   * remote-tracking ref, then refreshes so the ahead/behind indicator and
   * checkout options reflect the newly-fetched state.
   */
  private async handleFetchTarget(): Promise<void> {
    if (!this.stack) {
      return;
    }
    try {
      await commands.executeCommand(`${EXTENSION_NAME}.fetchBranch`, {
        branch: this.stack.target,
        repositoryPath: this.stack.repositoryPath,
      });
    } catch (error) {
      this.loggingService.warn(`Failed to fetch stack target branch: ${error}`);
    } finally {
      this.onRefreshRequested();
    }
  }

  /** Resolves the PR URL from the current stack — never trusts a URL sent by the webview. */
  private async handleOpenPr(prNumber: unknown): Promise<void> {
    if (typeof prNumber !== 'number' || !this.stack) {
      return;
    }
    const url = this.stack.branches.find((branch) => branch.pr?.number === prNumber)?.pr?.url;
    if (!url) {
      return;
    }
    await env.openExternal(Uri.parse(url));
  }

  private handleWebviewLog(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    const logMessage = `[StacksWebView] ${message}`;
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

  private getReactHtml(webview: Webview, extensionUri: Uri): string {
    const webviewDistPath = Uri.joinPath(extensionUri, 'dist', 'webview').fsPath;
    const stacksHtmlPath = path.join(webviewDistPath, 'stacks.html');

    try {
      const html = fs.readFileSync(stacksHtmlPath, 'utf8');
      const nonce = getNonce();
      return buildWebviewHtml(html, webview, extensionUri, nonce);
    } catch (error) {
      this.loggingService.error(`Failed to load built stacks webview: ${error}`);

      const errorMessage = error instanceof Error ? error.message : 'Unknown Error';

      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Stacks</title>
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
            <h2>Stacks</h2>
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
    // Nothing to clean up.
  }
}
