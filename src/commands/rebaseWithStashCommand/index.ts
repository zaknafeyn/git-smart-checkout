import * as vscode from 'vscode';

import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { RefDetailsCache } from '../../services/refDetailsCache';
import { BaseCommand } from '../command';
import { attachLazyEnrichment } from '../utils/enrichOnActive';
import { prepareInitialRefDetails, refreshRemainingRefDetails } from '../utils/refDetailsPrefetch';
import { getMergedBranchLists } from '../utils/getMergedBranchLists';
import { getRefDescription, getRefLabel } from '../utils/refFormatting';
import { GitExecutor } from '../../common/git/gitExecutor';

export class RebaseWithStashCommand extends BaseCommand {
  constructor(
    private configManager: ConfigurationManager,
    logService: LoggingService,
    private autoStashService: AutoStashService,
    private vscodeGitProvider?: VscodeGitProvider,
    private refDetailsCache?: RefDetailsCache
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
    const { useFastBranchList } = this.configManager.get();

    // Load instantly from VS Code's cached model; fall back to a local listing.
    let branchList: IGitRef[];
    let useEnrichment = false;
    const fastRefs = useFastBranchList ? await git.getAllRefListFast() : undefined;
    if (fastRefs && fastRefs.length > 0) {
      branchList = fastRefs;
      useEnrichment = true;
    } else {
      try {
        branchList = await git.getAllRefListExtended();
        void this.refDetailsCache?.upsertFromRefs(git.repositoryPath, branchList);
      } catch {
        throw new Error('Failed to fetch branch list.');
      }
    }

    type RefItem = vscode.QuickPickItem & { ref?: IGitRef };

    const toItem = (ref: IGitRef): RefItem => ({
      label: getRefLabel(ref),
      description: getRefDescription(ref),
      ref,
    });

    const buildItems = (): RefItem[] => {
      const [locals, remotes] = getMergedBranchLists(branchList, currentBranch);
      const tags = branchList.filter((r) => r.isTag);
      return [
        { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
        ...locals.map(toItem),
        { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
        ...remotes.map(toItem),
        { label: 'Tags', kind: vscode.QuickPickItemKind.Separator },
        ...tags.map(toItem),
      ];
    };

    const qp = vscode.window.createQuickPick<RefItem>();
    qp.title = 'Rebase onto...';
    qp.placeholder = 'Select a branch or tag to rebase onto';
    if (useEnrichment) {
      await prepareInitialRefDetails({
        repoKey: git.repositoryPath,
        refs: branchList,
        git,
        cache: this.refDetailsCache,
        buildItems,
      });
    }
    qp.items = buildItems();

    const enrichSub = useEnrichment
      ? attachLazyEnrichment({
        quickPick: qp,
        git,
        rebuild: buildItems,
        repoKey: git.repositoryPath,
        cache: this.refDetailsCache,
      })
      : undefined;

    const picked = await new Promise<IGitRef | undefined>((resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems[0]?.ref);
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
      if (useEnrichment) {
        refreshRemainingRefDetails({
          repoKey: git.repositoryPath,
          refs: branchList,
          git,
          cache: this.refDetailsCache,
          buildItems,
          quickPick: qp,
          rebuild: buildItems,
        });
      }
    });

    qp.dispose();
    enrichSub?.dispose();

    return picked;
  }
}
