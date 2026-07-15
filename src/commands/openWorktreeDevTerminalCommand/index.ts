import * as path from 'path';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture } from '../../analytics/analytics';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { buildWorktreeTerminalItems } from '../utils/worktreeTerminal';
import { BaseCommand } from '../command';

export class OpenWorktreeDevTerminalCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(preselectedWorktreePath?: string): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider, 'Open Worktree Dev Terminal');

      if (preselectedWorktreePath) {
        this.openTerminal(preselectedWorktreePath);
        capture(AnalyticsEvent.WorktreeDevTerminalOpened, { had_multiple_worktrees: true });
        return;
      }

      const worktrees = await git.worktreeListDetailed(true);

      // No worktrees (or just the current one): behave like opening a plain
      // terminal for the selected project without prompting.
      if (worktrees.length <= 1) {
        this.openTerminal(git.repositoryPath);
        capture(AnalyticsEvent.WorktreeDevTerminalOpened, { had_multiple_worktrees: false });
        return;
      }

      const picked = await vscode.window.showQuickPick(
        buildWorktreeTerminalItems(worktrees, git.repositoryPath),
        {
          title: 'Open Worktree Dev Terminal',
          placeHolder: 'Select a worktree to open a terminal in',
        }
      );

      if (!picked) {
        return;
      }

      this.openTerminal(picked.worktreePath);
      capture(AnalyticsEvent.WorktreeDevTerminalOpened, { had_multiple_worktrees: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(message, 'OK'));
    }
  }

  private openTerminal(cwd: string): void {
    const name = path.basename(cwd);
    this.logService.info(`Opening dev terminal in worktree: ${cwd}`);

    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show();
  }
}
