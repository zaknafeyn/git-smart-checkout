import * as vscode from 'vscode';

import { CheckoutToCommand } from './commands/checkoutToCommand';
import { CommandManager } from './commands/commandManager';
import { PullWithStashCommand } from './commands/pullWithStashCommand';
import { SwitchModeCommand } from './commands/switchModeCommand';
import { ConfigurationManager } from './configuration/configurationManager';
import { EXTENSION_NAME } from './const';
import { LoggingService } from './logging/loggingService';
import { StatusBarManager } from './statusBar/statusBarManager';
import { PrCloneWebViewProvider } from './view/PrCloneWebViewProvider';
import { PrCommitsWebViewProvider } from './view/PrCommitsWebViewProvider';
import { commands } from 'vscode';
import { setContextShowPRClone, setContextShowPRCommits } from './utils/setContext';
import { PrCloneService } from './services/prCloneService';
import { getGitExecutor } from './utils/getGitExecutor';
import { GitHubClient } from './common/api/ghClient';

export function activate(context: vscode.ExtensionContext) {
  console.log(`Extension "${EXTENSION_NAME}" is now active!`);

  const commandManager = new CommandManager();

  const configManager = new ConfigurationManager();
  const logService = new LoggingService(configManager);
  const statusBarManager = new StatusBarManager(configManager, logService);
  const prCloneService = new PrCloneService(context, logService, configManager);
  const prCloneWebViewProvider = new PrCloneWebViewProvider(
    context,
    logService,
    configManager,
    prCloneService
  );
  const prCommitsWebViewProvider = new PrCommitsWebViewProvider(
    context,
    logService,
    prCloneService
  );

  logService.info('Start...');

  // Set initial context to hide PR Clone view and commits view
  setContextShowPRClone(false);
  setContextShowPRCommits(false);

  // Register commands
  const switchModeCommand = new SwitchModeCommand(statusBarManager, logService);
  const checkoutToCommand = new CheckoutToCommand(configManager, logService);
  const pullWithStashCommand = new PullWithStashCommand(configManager, logService);

  commandManager.registerCommand(`${EXTENSION_NAME}.switchMode`, switchModeCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutTo`, checkoutToCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.pullWithStash`, pullWithStashCommand);

  // Register clone pull request command
  const clonePullRequestCommand = commands.registerCommand(
    `${EXTENSION_NAME}.clonePullRequest`,
    async () => {
      // get exact repository
      const git = await getGitExecutor(logService);

      const repoInfo = await git.getRepoInfo();
      if (!repoInfo) {
        throw new Error('Could not determine GitHub repository information');
      }

      const ghClient = new GitHubClient(repoInfo.owner, repoInfo.repo);

      prCloneService.init(git, ghClient);

      // Show the PR Clone view by setting the context
      setContextShowPRClone(true);
      // Show the Git Smart Checkout activity bar
      commands.executeCommand(`workbench.view.extension.${EXTENSION_NAME}`);
      // TODO: change this to clear state at the moment of the first mount of App.tsx
      setTimeout(() => {
        // Wait until app fully initialized and clear webview state to start fresh
        prCloneWebViewProvider.clearState();
      }, 250);
    }
  );

  // Set up communication between webviews
  prCloneWebViewProvider.setCommitsProvider(prCommitsWebViewProvider);

  // Register command to update selected commits (internal communication)
  const updateSelectedCommitsCommand = commands.registerCommand(
    `${EXTENSION_NAME}.updateSelectedCommits`,
    (selectedCommits: string[]) => {
      // Pass selected commits to main webview
      prCloneWebViewProvider.updateSelectedCommits(selectedCommits);
    }
  );

  // Register command to handle notifications from WebView (used by commits webview)
  const showNotificationCommand = commands.registerCommand(
    `${EXTENSION_NAME}.showNotification`,
    async (message: string, type: 'info' | 'warn' | 'error' = 'info') => {
      switch (type) {
        case 'info':
          await vscode.window.showInformationMessage(message, 'OK');
          break;
        case 'warn':
          await vscode.window.showWarningMessage(message, 'OK');
          break;
        case 'error':
          await vscode.window.showErrorMessage(message, 'OK');
          break;
      }
    }
  );

  // Register PR Clone menu command
  const prCancelCloneMenuCommand = commands.registerCommand(
    `${EXTENSION_NAME}.prCancelCloneMenu`,
    async () => {
      prCloneService.abortClonePR();
    }
  );

  // Register Cherry Pick PR conflicts Resolved menu command
  const prConflictsResolvedMenuCommand = commands.registerCommand(
    `${EXTENSION_NAME}.prConflictsResolvedMenu`,
    async () => {
      await prCloneService.cherryPickNext(true);
    }
  );

  // Register all commands with VS Code
  commandManager.registerAll(context);

  // Listen for configuration changes
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_NAME)) {
      configManager.reload();
      statusBarManager.onConfigurationChanged();
    }
  });

  // Add to context subscriptions
  context.subscriptions.push(
    configChangeListener,
    statusBarManager,
    logService,
    clonePullRequestCommand,
    updateSelectedCommitsCommand,
    showNotificationCommand,
    prCancelCloneMenuCommand,
    prConflictsResolvedMenuCommand,
    prSkipCherryPickMenuCommand,
    prCloneWebViewProvider,
    prCommitsWebViewProvider,
    vscode.window.registerWebviewViewProvider(`${EXTENSION_NAME}.prClone`, prCloneWebViewProvider),
    vscode.window.registerWebviewViewProvider(
      `${EXTENSION_NAME}.prCommits`,
      prCommitsWebViewProvider
    )
  );

  // Show status bar
  statusBarManager.show();

  // Store command manager in context for testing
  context.globalState.update('commandManager', commandManager);
}

export function deactivate() {
  console.log('Extension "my-vscode-extension" is now deactivated!');
}
