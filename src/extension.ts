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
import { PrCommitsTreeProvider } from './view/PrCommitsTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "my-vscode-extension" is now active!');

  const commandManager = new CommandManager();

  const configManager = new ConfigurationManager();
  const logService = new LoggingService(configManager);
  const statusBarManager = new StatusBarManager(configManager, logService);
  const prCloneWebViewProvider = new PrCloneWebViewProvider(context, logService, configManager);
  const prCommitsTreeProvider = new PrCommitsTreeProvider(context, logService);

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
  prCloneWebViewProvider.setCommitsProvider(prCommitsTreeProvider);

  // Register command to update selected commits (internal communication)
  const updateSelectedCommitsCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.updateSelectedCommits`,
    (selectedCommits: string[]) => {
      // Pass selected commits to main webview
      prCloneWebViewProvider.updateSelectedCommits(selectedCommits);
    }
  );

  // Register command to toggle commit selection in tree view
  const toggleCommitCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.toggleCommit`,
    (item: any) => {
      if (item && item.id) {
        prCommitsTreeProvider.handleCommitToggle(item.id);
      }
    }
  );

  // Register command to copy commits to clipboard
  const copyCommitsToClipboardCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.copyCommitsToClipboard`,
    async () => {
      try {
        const commits = prCommitsTreeProvider.getCommits();
        if (commits.length === 0) {
          await vscode.window.showInformationMessage('No commits available to copy', 'OK');
          return;
        }

        const commitLines = commits.map((commit: any) => {
          const isBackMerge = commit.parents.length > 1;
          const prefix = isBackMerge ? 'B' : 'C';
          const description = commit.commit.message.split('\n')[0];
          return `${prefix}: ${commit.sha} - ${description}`;
        });

        const clipboardContent = commitLines.join('\n');
        await vscode.env.clipboard.writeText(clipboardContent);
        
        await vscode.window.showInformationMessage(`Copied ${commits.length} commits to clipboard`, 'OK');
        logService.info(`Copied ${commits.length} commits to clipboard`);
      } catch (error) {
        logService.error(`Failed to copy commits to clipboard: ${error}`);
        await vscode.window.showErrorMessage(`Failed to copy commits to clipboard: ${error}`, 'OK');
      }
    }
  );

  // Register command to select all commits
  const selectAllCommitsCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.selectAllCommits`,
    () => {
      prCommitsTreeProvider.selectAllCommits();
      logService.info('Selected all commits');
    }
  );

  // Register command to deselect all commits
  const deselectAllCommitsCommand = vscode.commands.registerCommand(
    `${EXTENSION_NAME}.deselectAllCommits`,
    () => {
      prCommitsTreeProvider.deselectAllCommits();
      logService.info('Deselected all commits');
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
    toggleCommitCommand,
    copyCommitsToClipboardCommand,
    selectAllCommitsCommand,
    deselectAllCommitsCommand,
    prCloneWebViewProvider,
    vscode.window.registerWebviewViewProvider(`${EXTENSION_NAME}.prClone`, prCloneWebViewProvider),
    vscode.window.createTreeView(`${EXTENSION_NAME}.prCommits`, { treeDataProvider: prCommitsTreeProvider, showCollapseAll: true, canSelectMany: false })
  );

  // Show status bar
  statusBarManager.show();

  // Store command manager in context for testing
  context.globalState.update('commandManager', commandManager);
}

export function deactivate() {
  console.log('Extension "my-vscode-extension" is now deactivated!');
}
