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

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "my-vscode-extension" is now active!');

  const commandManager = new CommandManager();

  const configManager = new ConfigurationManager();
  const logService = new LoggingService(configManager);
  const statusBarManager = new StatusBarManager(configManager, logService);
  const prCloneWebViewProvider = new PrCloneWebViewProvider(context, logService, configManager);
  const prCommitsWebViewProvider = new PrCommitsWebViewProvider(context, logService);

  logService.info('Start...');

  // Set initial context to hide PR Clone view and commits view
  vscode.commands.executeCommand('setContext', `${EXTENSION_NAME}.showPrClone`, false);
  vscode.commands.executeCommand('setContext', `${EXTENSION_NAME}.showPrCommits`, false);

  // Register commands
  const switchModeCommand = new SwitchModeCommand(statusBarManager, logService);
  const checkoutToCommand = new CheckoutToCommand(configManager, logService);
  const pullWithStashCommand = new PullWithStashCommand(configManager, logService);

  commandManager.registerCommand(`${EXTENSION_NAME}.switchMode`, switchModeCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutTo`, checkoutToCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.pullWithStash`, pullWithStashCommand);

  // Register clone pull request command
  const clonePullRequestCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.clonePullRequest`,
    () => {
      // Show the PR Clone view by setting the context
      vscode.commands.executeCommand('setContext', `${EXTENSION_NAME}.showPrClone`, true);
      logService.info('... test log msg');
      // Show the Git Smart Checkout activity bar
      vscode.commands.executeCommand(`workbench.view.extension.${EXTENSION_NAME}`);
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
  const updateSelectedCommitsCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.updateSelectedCommits`,
    (selectedCommits: string[]) => {
      // Pass selected commits to main webview
      prCloneWebViewProvider.updateSelectedCommits(selectedCommits);
    }
  );

  // Register command to handle notifications from WebView (used by commits webview)
  const showNotificationCommand = vscode.commands.registerCommand(
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
  const prCancelCloneMenuCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.prCancelCloneMenu`,
    async () => {
      await vscode.window.showInformationMessage('Cancelling PR clone', 'OK');
    }
  );

  // Register Cherry Pick PR conflicts Resolved menu command
  const prConflictsResolvedMenuCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.prConflictsResolvedMenu`,
    async () => {
      await vscode.window.showInformationMessage('Conflicts are resolved', 'OK');
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
