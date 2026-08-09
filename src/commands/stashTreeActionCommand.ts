import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../analytics/analytics';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitStash } from '../common/git/types';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';
import { confirmDirtyWorktree, confirmDropStashes, StashService } from '../services/stashService';
import { BaseCommand } from './command';
import { resolveStashArg } from './utils/resolveStashArg';

export type StashTreeAction = 'apply' | 'pop' | 'drop' | 'viewPatch' | 'createBranch' | 'copyMessage';

/**
 * Handles inline/context-menu actions triggered from the Stashes tree view. Business logic
 * (hash-verified selectors, conflict rescue, the shared `onDidChangeStashes` notification) lives
 * in `StashService`, shared with `ManageAutoStashesCommand`; this class only resolves the tree
 * selection into `IGitStash[]` + a repository, and owns the confirmation/notification UI.
 */
export class StashTreeActionCommand extends BaseCommand {
  constructor(
    private readonly action: StashTreeAction,
    logService: LoggingService,
    private readonly stashService: StashService,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(item?: unknown, items?: unknown): Promise<void> {
    const resolved = resolveStashArg(item, items);
    if (!resolved) {
      return;
    }
    const { stashes, repositoryPath } = resolved;
    const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);

    switch (this.action) {
      case 'apply':
        await this.applyOrPop(git, stashes[0], 'apply');
        return;
      case 'pop':
        await this.applyOrPop(git, stashes[0], 'pop');
        return;
      case 'drop':
        await this.drop(git, stashes);
        return;
      case 'viewPatch':
        await this.viewPatch(git, stashes[0]);
        return;
      case 'createBranch':
        await this.createBranch(git, stashes[0]);
        return;
      case 'copyMessage':
        await vscode.env.clipboard.writeText(stashes[0].message);
        return;
    }
  }

  private async applyOrPop(git: GitExecutor, stash: IGitStash, action: 'apply' | 'pop'): Promise<void> {
    try {
      const hadChanges = await git.isWorkdirHasChanges();
      if (hadChanges && !(await confirmDirtyWorktree(action))) {
        return;
      }

      const result =
        action === 'apply'
          ? await this.stashService.applyStash(git, stash)
          : await this.stashService.popStash(git, stash);

      capture(AnalyticsEvent.AutoStashManaged, {
        action,
        file_count: stash.files.length,
        had_changes: hadChanges,
        ...(result === 'rescued' ? { stashConflict: true } : {}),
      });

      if (result !== 'rescued') {
        await vscode.window.showInformationMessage(
          action === 'apply' ? 'Stash applied.' : 'Stash popped.',
          'OK'
        );
      }
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(`Failed to ${action} the stash: ${message}`, 'OK'));
    }
  }

  private async drop(git: GitExecutor, stashes: IGitStash[]): Promise<void> {
    try {
      // Multi-select Drop shows one confirmation modal for the whole batch, not one per stash.
      if (!(await confirmDropStashes(stashes))) {
        return;
      }

      await this.stashService.dropStashes(git, stashes);

      capture(AnalyticsEvent.AutoStashManaged, {
        action: 'drop',
        file_count: stashes.reduce((sum, stash) => sum + stash.files.length, 0),
        had_changes: false,
        count: stashes.length,
      });

      await vscode.window.showInformationMessage(
        stashes.length === 1 ? 'Stash dropped.' : `${stashes.length} stashes dropped.`,
        'OK'
      );
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(`Failed to drop the stash(es): ${message}`, 'OK'));
    }
  }

  private async viewPatch(git: GitExecutor, stash: IGitStash): Promise<void> {
    try {
      const patch = await this.stashService.getStashPatch(git, stash);
      if (!patch) {
        await vscode.window.showInformationMessage('This stash has no diff to display.', 'OK');
        return;
      }

      const document = await vscode.workspace.openTextDocument({ content: patch, language: 'diff' });
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(`Failed to load the stash patch: ${message}`, 'OK'));
    }
  }

  private async createBranch(git: GitExecutor, stash: IGitStash): Promise<void> {
    const branchName = await vscode.window.showInputBox({
      title: 'Create Branch from Stash',
      prompt: 'Name of the new branch',
      value: stash.sourceBranch ?? '',
      validateInput: (value) => (value.trim() ? undefined : 'Branch name is required.'),
    });
    if (!branchName) {
      return;
    }

    try {
      const trimmed = branchName.trim();
      await this.stashService.createBranchFromStash(git, stash, trimmed);
      await vscode.window.showInformationMessage(`Created branch "${trimmed}" from the stash.`, 'OK');
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(`Failed to create a branch from the stash: ${message}`, 'OK'));
    }
  }
}
