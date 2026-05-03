import * as vscode from 'vscode';

import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { BaseCommand } from '../command';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import { getRefDescription, getRefLabel } from '../utils/refFormatting';
import { GitExecutor } from '../../common/git/gitExecutor';

export class RebaseWithStashCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    try {
      const git = await this.getGitExecutor(this.vscodeGitProvider);

      const currentBranch = await git.getCurrentBranch();
      if (!currentBranch) {
        throw new Error('Could not determine the current branch. Are you in a git repository?');
      }

      const rebaseMode = await this.autoStashService.getRebaseStashMode();
      if (!rebaseMode) {
        return;
      }

      const targetRef = await this.selectRebaseTarget(git, currentBranch);
      if (!targetRef) {
        return;
      }

      const targetRefName = targetRef.remote ? targetRef.fullName : targetRef.name;

      await this.autoStashService.rebaseAndStashChanges(
        git,
        currentBranch,
        targetRefName,
        rebaseMode,
        this.vscodeGitProvider
      );
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message;
        message && (await vscode.window.showErrorMessage(message, 'OK'));
      } else {
        await vscode.window.showErrorMessage('Unknown error', 'OK');
      }
    }
  }

  private async selectRebaseTarget(git: GitExecutor, currentBranch: string): Promise<IGitRef | undefined> {
    let branchList: IGitRef[];
    try {
      branchList = await git.getAllRefListExtended(false);
    } catch {
      throw new Error('Failed to fetch branch list.');
    }

    const [locals, remotes] = getMergedBranchLists(branchList, currentBranch);
    const tags = branchList.filter((r) => r.isTag);

    type RefItem = vscode.QuickPickItem & { ref: IGitRef };

    const toItem = (ref: IGitRef): RefItem => ({
      label: getRefLabel(ref),
      description: getRefDescription(ref),
      ref,
    });

    const items: (vscode.QuickPickItem | RefItem)[] = [
      { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
      ...locals.map(toItem),
      { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
      ...remotes.map(toItem),
      { label: 'Tags', kind: vscode.QuickPickItemKind.Separator },
      ...tags.map(toItem),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Rebase onto...',
      placeHolder: 'Select a branch or tag to rebase onto',
    });

    return (picked as RefItem | undefined)?.ref;
  }
}
