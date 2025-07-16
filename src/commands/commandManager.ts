import * as vscode from 'vscode';
import { ICommand } from './command';

export class CommandManager {
  private commands: Map<string, ICommand> = new Map();
  private disposables: vscode.Disposable[] = [];

  registerCommand(commandId: string, command: ICommand): void {
    this.commands.set(commandId, command);
  }

  getCommand(commandId: string): ICommand | undefined {
    return this.commands.get(commandId);
  }

  getAllCommands(): Map<string, ICommand> {
    return new Map(this.commands);
  }

  registerAll(context: vscode.ExtensionContext): void {
    for (const [commandId, command] of this.commands) {
      const disposable = vscode.commands.registerCommand(commandId, async (...args: any[]) => {
        try {
          await command.execute(...args);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Command failed: ${errorMessage}`);
          console.error(`Error executing command ${commandId}:`, error);
        }
      });

      this.disposables.push(disposable);
      context.subscriptions.push(disposable);
    }
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this.commands.clear();
  }
}
