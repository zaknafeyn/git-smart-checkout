import * as vscode from 'vscode';
import { CommandManager } from './commands/commandManager';
import { CheckoutToCommand } from './commands/checkoutToCommand';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "my-vscode-extension" is now active!');

  const commandManager = new CommandManager();

  // Register commands
  const checkoutToCommand = new CheckoutToCommand();

  commandManager.registerCommand('git-smart-checkout.checkoutTo', checkoutToCommand);

  // Register all commands with VS Code
  commandManager.registerAll(context);

  // Store command manager in context for testing
  context.globalState.update('commandManager', commandManager);
}

export function deactivate() {
  console.log('Extension "my-vscode-extension" is now deactivated!');
}
