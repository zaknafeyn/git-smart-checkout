import * as vscode from 'vscode';
import { showErrorMessageWithIssueAction } from '../utils/errorIssueNotification';
import { UserCancelledError } from '../utils/userCancelledError';
import { ICommand } from './command';

export interface RegisterCommandOptions {
  /**
   * Marks a command as mutating worktree state (creating, removing, or
   * copying changes into/out of a worktree). When such a command completes
   * successfully, `onCommandCompleted` is invoked so listeners (e.g. the
   * Worktrees tree view) can refresh.
   */
  mutatesWorktrees?: boolean;
}

export class CommandManager {
  private commands: Map<string, ICommand> = new Map();
  private mutatingCommandIds: Set<string> = new Set();
  private disposables: vscode.Disposable[] = [];
  private onCommandCompleted?: (commandId: string) => void;

  registerCommand(commandId: string, command: ICommand, options?: RegisterCommandOptions): void {
    this.commands.set(commandId, command);
    if (options?.mutatesWorktrees) {
      this.mutatingCommandIds.add(commandId);
    }
  }

  /**
   * Registers a callback invoked after any worktree-mutating command
   * (registered with `{ mutatesWorktrees: true }`) completes successfully.
   */
  setOnCommandCompleted(callback: (commandId: string) => void): void {
    this.onCommandCompleted = callback;
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
          if (this.mutatingCommandIds.has(commandId)) {
            this.onCommandCompleted?.(commandId);
          }
        } catch (error) {
          if (error instanceof UserCancelledError) {
            return;
          }
          const errorMessage = error instanceof Error ? error.message : String(error);
          await showErrorMessageWithIssueAction(`Command failed: ${errorMessage}`, 'OK');
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
    this.mutatingCommandIds.clear();
  }
}
