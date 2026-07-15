import { formatDistanceToNow } from 'date-fns';
import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitStash } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';
import { AUTO_STASH_PREFIX } from '../checkoutToCommand/constants';
import { offerConflictRescue } from '../../services/stashConflictRescue';

const ACTION_APPLY = 'Apply';
const ACTION_POP = 'Pop';
const ACTION_DIFF = 'View Diff';
const ACTION_DROP = 'Drop';
const ACTION_CONTINUE = 'Continue';
const ACTION_CANCEL = 'Cancel';

type StashAction = 'apply' | 'pop' | 'diff' | 'drop';
type StashQuickPickItem = vscode.QuickPickItem & { stash: IGitStash };
type ActionQuickPickItem = vscode.QuickPickItem & { action: StashAction };

export class ManageAutoStashesCommand extends BaseCommand {
  constructor(
    logService: LoggingService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider, 'Manage auto-stashes');

      while (true) {
        const stashes = (await git.listStashes()).filter((stash) =>
          stash.message.startsWith(`${AUTO_STASH_PREFIX}-`)
        );

        if (stashes.length === 0) {
          await vscode.window.showInformationMessage('No auto-stashes found.', 'OK');
          return;
        }

        const stash = await this.selectStash(stashes);
        if (!stash) {
          return;
        }

        const action = await this.selectAction(stash);
        if (!action) {
          continue;
        }

        const hadChanges = await git.isWorkdirHasChanges();
        if (
          (action === 'apply' || action === 'pop') &&
          hadChanges &&
          !(await this.confirmDirtyWorktree(action))
        ) {
          continue;
        }

        if (action === 'drop' && !(await this.confirmDrop(stash))) {
          continue;
        }

        const stashConflict = await this.runAction(git, stash, action);
        capture(AnalyticsEvent.AutoStashManaged, {
          action,
          file_count: stash.files.length,
          had_changes: hadChanges,
          ...(stashConflict ? { stashConflict: true } : {}),
        });
      }
    } catch (error) {
      captureException(error);
      const message = error instanceof Error ? error.message : String(error);
      message && (await this.showErrorMessage(`Failed to manage auto-stashes: ${message}`, 'OK'));
    }
  }

  private async selectStash(stashes: IGitStash[]): Promise<IGitStash | undefined> {
    const items: StashQuickPickItem[] = stashes.map((stash) => ({
      label: `$(archive) ${stash.sourceBranch ?? 'Unknown branch'}`,
      description: `${formatDistanceToNow(stash.timestamp * 1000, {
        addSuffix: true,
      })} • ${this.formatFileCount(stash.files.length)}`,
      detail: [stash.message, stash.files.join(', ')].filter(Boolean).join(' • '),
      stash,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Manage auto-stashes',
      placeHolder: 'Select an auto-stash',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    return picked?.stash;
  }

  private async selectAction(stash: IGitStash): Promise<StashAction | undefined> {
    const items: ActionQuickPickItem[] = [
      {
        label: `$(files) ${ACTION_APPLY}`,
        detail: 'Restore the changes and keep the stash.',
        action: 'apply',
      },
      {
        label: `$(move) ${ACTION_POP}`,
        detail: 'Restore the changes and remove the stash when Git succeeds.',
        action: 'pop',
      },
      {
        label: `$(diff) ${ACTION_DIFF}`,
        detail: 'Open the stash patch, including untracked files.',
        action: 'diff',
      },
      {
        label: `$(trash) ${ACTION_DROP}`,
        detail: 'Permanently delete the stash.',
        action: 'drop',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `Manage auto-stashes: ${stash.sourceBranch ?? stash.message}`,
      placeHolder: 'Select an action',
    });

    return picked?.action;
  }

  private async confirmDirtyWorktree(action: 'apply' | 'pop'): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `The current worktree has uncommitted changes. ${action === 'apply' ? ACTION_APPLY : ACTION_POP} this auto-stash anyway?`,
      { modal: true },
      ACTION_CONTINUE,
      ACTION_CANCEL
    );

    return choice === ACTION_CONTINUE;
  }

  private async confirmDrop(stash: IGitStash): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Permanently drop the auto-stash for "${stash.sourceBranch ?? 'unknown branch'}"?`,
      { modal: true },
      ACTION_DROP,
      ACTION_CANCEL
    );

    return choice === ACTION_DROP;
  }

  /**
   * Runs the selected stash action. Returns true when the action ended in a
   * conflict-rescue path (so the caller can tag analytics instead of reporting
   * a plain success) and false otherwise.
   */
  private async runAction(
    git: GitExecutor,
    stash: IGitStash,
    action: StashAction
  ): Promise<boolean> {
    switch (action) {
      case 'apply': {
        const selector = await git.resolveStashSelector(stash.selector, stash.hash);
        try {
          await git.applyStash(selector);
        } catch (error) {
          const conflicts = await git.getConflictedFiles();
          if (conflicts.length === 0) throw error;
          await offerConflictRescue(git, conflicts, 'apply');
          return true;
        }
        await vscode.window.showInformationMessage('Auto-stash applied.', 'OK');
        return false;
      }
      case 'pop': {
        const selector = await git.resolveStashSelector(stash.selector, stash.hash);
        try {
          await git.popStashBySelector(selector);
        } catch (error) {
          const conflicts = await git.getConflictedFiles();
          if (conflicts.length === 0) throw error;
          await offerConflictRescue(git, conflicts, 'pop');
          return true;
        }
        await vscode.window.showInformationMessage('Auto-stash popped.', 'OK');
        return false;
      }
      case 'drop': {
        const selector = await git.resolveStashSelector(stash.selector, stash.hash);
        await git.dropStash(selector);
        await vscode.window.showInformationMessage('Auto-stash dropped.', 'OK');
        return false;
      }
      case 'diff': {
        const patch = await git.getStashPatch(stash.selector);
        if (!patch) {
          await vscode.window.showInformationMessage('This auto-stash has no diff to display.', 'OK');
          return false;
        }

        const document = await vscode.workspace.openTextDocument({
          content: patch,
          language: 'diff',
        });
        await vscode.window.showTextDocument(document, { preview: true });
        return false;
      }
    }
  }

  private formatFileCount(count: number): string {
    return `${count} ${count === 1 ? 'file' : 'files'}`;
  }
}
