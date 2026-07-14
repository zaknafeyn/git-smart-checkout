import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';
import { BaseCommand } from './command';

export type WorktreeTreeAction = 'open' | 'terminal' | 'remove';

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
    if (this.action === 'open') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
      return;
    }
    if (this.action === 'terminal') {
      const terminal = vscode.window.createTerminal({ name: 'Worktree', cwd: worktreePath });
      terminal.show();
      return;
    }
    if (!repositoryPath) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Remove worktree at ${worktreePath}?`,
      { modal: true },
      'Remove Worktree'
    );
    if (confirmed !== 'Remove Worktree') return;
    await new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider).worktreeRemove(worktreePath, false);
    await vscode.window.showInformationMessage(`Worktree removed: ${worktreePath}`);
  }
}
