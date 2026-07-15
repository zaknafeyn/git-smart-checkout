import * as vscode from 'vscode';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

export class CleanupBranchesCommand extends BaseCommand {
  constructor(logService: LoggingService, private readonly provider?: VscodeGitProvider) { super(logService); }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor(this.provider, 'Delete merged branches');
    const current = await git.getCurrentBranch();
    const base = await git.getDefaultBranch();
    const merged = new Set(await git.getMergedBranches(base));
    const worktreeBranches = new Set((await git.worktreeListDetailed(true)).map((item) => item.branch?.replace(/^refs\/heads\//, '')));
    const refs = (await git.getAllRefListExtended()).filter((ref) => !ref.remote && !ref.isTag);
    const candidates = refs.filter((ref) => ref.name !== current && ref.name !== base && !worktreeBranches.has(ref.name) && merged.has(ref.name));
    if (candidates.length === 0) {
      await vscode.window.showInformationMessage('No merged or orphaned branches to clean up.', 'OK');
      return;
    }
    const selected = await vscode.window.showQuickPick(candidates.map((ref) => ({ label: ref.name, picked: true, ref })), { canPickMany: true, title: `Delete merged branches (base: ${base})` });
    if (!selected?.length) return;
    const confirmed = await vscode.window.showWarningMessage(`Delete ${selected.length} branches? They can be recovered from the reflog for ~30 days.`, { modal: true }, 'Delete');
    if (confirmed !== 'Delete') return;
    let deleted = 0;
    for (const item of selected) {
      try { await git.deleteBranch(item.ref.name, false); deleted += 1; } catch (error) { this.logService.warn(`Failed to delete ${item.ref.name}: ${error}`); }
    }
    await vscode.window.showInformationMessage(`Deleted ${deleted} branches`, 'OK');
  }
}
