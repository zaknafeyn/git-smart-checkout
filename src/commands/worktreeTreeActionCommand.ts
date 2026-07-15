import * as vscode from 'vscode';
import { CopyWipChangesToWorktreeCommand } from './copyChangesToWorktreeCommand';
import { OpenWorktreeDevTerminalCommand } from './openWorktreeDevTerminalCommand';
import { RemoveWorktreeCommand } from './removeWorktreeCommand';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';
import { addToWorkspace } from './utils/worktreeCompletionActions';
import { BaseCommand } from './command';

export type WorktreeTreeAction =
  | 'open'
  | 'terminal'
  | 'remove'
  | 'copyWip'
  | 'addToWorkspace'
  | 'copyPath'
  | 'reveal';

/**
 * Handles inline/context-menu actions triggered from the Worktrees tree view.
 * Actions that duplicate an existing command's business logic (dirty-state
 * handling, picker fallback, analytics) delegate to that command with the
 * tree's selected worktree path pre-bound, rather than reimplementing it.
 */
export class WorktreeTreeActionCommand extends BaseCommand {
  constructor(
    private readonly action: WorktreeTreeAction,
    logService: LoggingService,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(worktreePath?: string, repositoryPath?: string): Promise<void> {
    if (!worktreePath) return;

    switch (this.action) {
      case 'open':
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
        return;
      case 'terminal':
        await new OpenWorktreeDevTerminalCommand(this.logService, this.vscodeGitProvider).execute(
          worktreePath
        );
        return;
      case 'copyWip':
        await new CopyWipChangesToWorktreeCommand(this.logService, this.vscodeGitProvider).execute(
          worktreePath
        );
        return;
      case 'remove':
        await new RemoveWorktreeCommand(this.logService, this.vscodeGitProvider).execute(worktreePath);
        return;
      case 'addToWorkspace':
        addToWorkspace(worktreePath);
        return;
      case 'copyPath':
        await vscode.env.clipboard.writeText(worktreePath);
        await vscode.window.showInformationMessage(`Copied path: ${worktreePath}`);
        return;
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(worktreePath));
        return;
      default:
        void repositoryPath;
        return;
    }
  }
}
