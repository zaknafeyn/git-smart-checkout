import * as vscode from 'vscode';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';
import {
  buildCleanupQuickPickItems,
  buildRecoveryDocument,
  computeCleanupCandidates,
  ICleanupDeletionResult,
  summarizeDeletions,
  toSelectedCandidates,
} from './candidates';

const UNDO_HINT_ACTION = 'Undo hint';

export class CleanupBranchesCommand extends BaseCommand {
  constructor(logService: LoggingService, private readonly provider?: VscodeGitProvider) {
    super(logService);
  }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor(this.provider, 'Delete merged branches');
    const current = await git.getCurrentBranch();

    let base: string;
    try {
      base = await git.getDefaultBranch();
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Could not determine the default branch: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const mergedNames = new Set(await git.getMergedBranches(base));
    const worktreeBranches = new Set(
      (await git.worktreeListDetailed(true))
        .map((worktree) => worktree.branch?.replace(/^refs\/heads\//, ''))
        .filter((name): name is string => !!name)
    );
    const localRefs = (await git.getAllRefListExtended()).filter((ref) => !ref.remote && !ref.isTag);
    const candidates = computeCleanupCandidates(localRefs, mergedNames, worktreeBranches, current, base);

    if (candidates.length === 0) {
      await vscode.window.showInformationMessage('No merged or orphaned branches to clean up.', 'OK');
      return;
    }

    const items = buildCleanupQuickPickItems(candidates, base);
    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: `Delete merged branches (base: ${base})`,
    });
    const selectedCandidates = toSelectedCandidates(selected);
    if (selectedCandidates.length === 0) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete ${selectedCandidates.length} branches? They can be recovered from the reflog for ~30 days.`,
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') return;

    const results: ICleanupDeletionResult[] = [];
    for (const candidate of selectedCandidates) {
      const { ref, group } = candidate;
      try {
        // Tip SHA is captured up-front (before any deletion) via getAllRefListExtended.
        await git.deleteBranch(ref.name, group === 'gone');
        results.push({ name: ref.name, sha: ref.hash ?? '', success: true });
      } catch (error) {
        this.logService.warn(`Failed to delete ${ref.name}: ${error}`);
        results.push({ name: ref.name, sha: ref.hash ?? '', success: false });
      }
    }

    const summary = summarizeDeletions(results);
    const action = await vscode.window.showInformationMessage(summary, UNDO_HINT_ACTION);
    if (action === UNDO_HINT_ACTION) {
      const document = await vscode.workspace.openTextDocument({
        content: buildRecoveryDocument(results),
        language: 'shellscript',
      });
      await vscode.window.showTextDocument(document);
    }
  }
}
