import * as vscode from 'vscode';
import { CommandManager } from './commands/commandManager';
import { CheckoutToCommand } from './commands/checkoutToCommand';
import { LoggingService } from './logging/loggingService';
import { ConfigurationManager } from './configuration/configurationManager';
import { StatusBarManager } from './statusBar/statusBarManager';
import { EXTENSION_NAME } from './const';
import { SwitchModeCommand } from './commands/switchModeCommand';
import { PullWithStashCommand } from './commands/pullWithStashCommand';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "my-vscode-extension" is now active!');

  const commandManager = new CommandManager();

  const configManager = new ConfigurationManager();
  const logService = new LoggingService(configManager);
  let statusBarManager = new StatusBarManager(configManager, logService);

  logService.info('Start...');

  // Register commands
  const switchModeCommand = new SwitchModeCommand(statusBarManager, logService);
  const checkoutToCommand = new CheckoutToCommand(configManager, logService);
  const pullWithStashCommand = new PullWithStashCommand(configManager, logService);

  commandManager.registerCommand(`${EXTENSION_NAME}.switchMode`, switchModeCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutTo`, checkoutToCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.pullWithStash`, pullWithStashCommand);

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
  context.subscriptions.push(configChangeListener, statusBarManager, logService);

  // Show status bar
  statusBarManager.show();

  // Store command manager in context for testing
  context.globalState.update('commandManager', commandManager);
}

export function deactivate() {
  console.log('Extension "my-vscode-extension" is now deactivated!');
}
