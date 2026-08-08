import * as vscode from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { GitHubClient, resolveGitHubHostConfig } from '../common/api/ghClient';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { StackStore } from '../services/stackStore';
import { buildStackForest, topoOrder } from '../services/stackTopology';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';

export interface StackBranchEnrichment {
  prNumber?: number;
  prState?: string;
  ahead?: number;
  behind?: number;
  needsRestack?: boolean;
}

export class StackBranchTreeItem extends vscode.TreeItem {
  constructor(
    public readonly branch: string,
    public readonly parent: string,
    public readonly repositoryPath: string,
    public readonly isCurrent: boolean,
    enrichment?: StackBranchEnrichment
  ) {
    super(branch, vscode.TreeItemCollapsibleState.None);
    this.applyEnrichment(enrichment);
  }

  applyEnrichment(enrichment?: StackBranchEnrichment): void {
    const prPart = enrichment?.prNumber
      ? `PR #${enrichment.prNumber}`
      : enrichment
        ? '— no PR'
        : '';
    const trackPart =
      enrichment?.ahead !== undefined && enrichment?.behind !== undefined
        ? `⇡${enrichment.ahead} ⇣${enrichment.behind}`
        : '';
    const restackPart = enrichment?.needsRestack ? '• needs restack' : '';

    this.description = [prPart, trackPart, restackPart].filter(Boolean).join('  ');

    const lines = [
      `Branch: ${this.branch}`,
      `Parent: ${this.parent}`,
      enrichment?.prNumber ? `PR: #${enrichment.prNumber} (${enrichment.prState ?? 'open'})` : 'PR: none',
      enrichment
        ? `Ahead/behind parent: ⇡${enrichment.ahead ?? 0} ⇣${enrichment.behind ?? 0}`
        : 'Ahead/behind parent: (loading...)',
      enrichment?.needsRestack ? 'Needs restack: yes' : 'Needs restack: no',
    ];
    this.tooltip = lines.join('\n');

    this.iconPath = new vscode.ThemeIcon(this.isCurrent ? 'circle-filled' : 'circle-outline');

    const tags = ['stackBranch'];
    if (this.isCurrent) {
      tags.push('current');
    }
    if (enrichment?.needsRestack) {
      tags.push('needsRestack');
    }
    if (enrichment?.prNumber) {
      tags.push('hasPr');
    }
    this.contextValue = tags.join(' ');
  }
}

export class StackGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly root: string, public readonly children: StackBranchTreeItem[]) {
    super(`stack: ${root}`, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `(${children.length} branch${children.length === 1 ? '' : 'es'})`;
    this.contextValue = 'stackGroup';
    this.iconPath = new vscode.ThemeIcon('layers');
  }
}

type StackNode = StackGroupTreeItem | StackBranchTreeItem;

const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Tree view for detected stacks, following the two-phase render pattern
 * used by `WorktreeTreeDataProvider`: a fast phase 1 builds the forest
 * topology from the persisted `StackStore` alone, then phase 2
 * asynchronously enriches each branch with PR/ahead-behind/needs-restack
 * state and fires a per-item change event as each resolves.
 *
 * Detection itself (populating the store) is driven externally — see
 * `extension.ts` — this provider only reads the store and renders it.
 */
export class StackTreeDataProvider implements vscode.TreeDataProvider<StackNode> {
  private readonly changeEmitter = new vscode.EventEmitter<StackNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private groups: StackGroupTreeItem[] = [];
  private loaded = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly logService: LoggingService,
    private readonly store: StackStore,
    private readonly configManager: ConfigurationManager,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {}

  getTreeItem(element: StackNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StackNode): Promise<StackNode[]> {
    if (!this.loaded) {
      await this.load();
    }
    if (element instanceof StackGroupTreeItem) {
      return element.children;
    }
    if (element) {
      return [];
    }
    return this.groups;
  }

  refresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.loaded = false;
    this.groups = [];
    this.changeEmitter.fire(undefined);
  }

  refreshDebounced(delayMs = DEFAULT_DEBOUNCE_MS): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.refresh();
    }, delayMs);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.changeEmitter.dispose();
  }

  private async load(): Promise<void> {
    const config = this.configManager.get();
    if (!config.stacks.enabled) {
      this.groups = [];
      this.loaded = true;
      return;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    const groups: StackGroupTreeItem[] = [];
    const enrichmentTasks: Array<() => Promise<void>> = [];

    for (const folder of folders) {
      try {
        const repositoryPath = await resolveGitRepositoryRoot(folder.uri.fsPath, this.logService);
        const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
        const [entries, refs, currentBranch] = await Promise.all([
          this.store.getAll(),
          git.getAllRefListExtended(),
          git.getCurrentBranch().catch(() => undefined),
        ]);
        const liveBranches = new Set(
          refs.filter((ref) => !ref.remote && !ref.isTag).map((ref) => ref.name)
        );
        const forest = buildStackForest(entries, liveBranches);

        for (const root of forest.roots) {
          const order = topoOrder(root, forest.childrenOf);
          if (order.length <= 1) {
            // A lone branch with no recorded children/parent isn't a stack.
            continue;
          }
          const branchItems = order.map(
            (branch) =>
              new StackBranchTreeItem(
                branch,
                forest.parentOf.get(branch) ?? root,
                repositoryPath,
                branch === currentBranch
              )
          );
          const group = new StackGroupTreeItem(root, branchItems);
          groups.push(group);
          branchItems.forEach((item) => {
            enrichmentTasks.push(() => this.enrichItem(item, git, repositoryPath));
          });
        }
      } catch (error) {
        this.logService.warn(`Failed to load stacks for ${folder.uri.fsPath}: ${error}`);
      }
    }

    this.groups = groups;
    this.loaded = true;

    // Fire-and-forget: enrichment must not block the initial render.
    void Promise.all(enrichmentTasks.map((task) => task()));
  }

  private async enrichItem(item: StackBranchTreeItem, git: GitExecutor, repositoryPath: string): Promise<void> {
    try {
      const config = this.configManager.get();
      const needsRestackPromise = git.isAncestor(item.parent, item.branch).then((ok) => !ok);
      const aheadPromise = git.revListCount(item.parent, item.branch);
      const behindPromise = git.revListCount(item.branch, item.parent);
      const prPromise = this.findPullRequest(git, repositoryPath, item.branch, config.githubEnterpriseBaseUrl);

      const [needsRestack, ahead, behind, pr] = await Promise.all([
        needsRestackPromise,
        aheadPromise,
        behindPromise,
        prPromise,
      ]);

      item.applyEnrichment({
        needsRestack,
        ahead,
        behind,
        prNumber: pr?.number,
        prState: pr?.state,
      });
    } catch (error) {
      this.logService.warn(`Failed to enrich stack branch ${item.branch}: ${error}`);
      item.applyEnrichment({ needsRestack: false, ahead: 0, behind: 0 });
    }
    this.changeEmitter.fire(item);
  }

  /**
   * Looks up an open PR for `branch`, skipping silently (returning
   * undefined) when the repo has no GitHub remote or the user isn't
   * authenticated — PR enrichment is best-effort and must never throw.
   */
  private async findPullRequest(
    git: GitExecutor,
    repositoryPath: string,
    branch: string,
    githubEnterpriseBaseUrl: string
  ): Promise<{ number: number; state?: string } | undefined> {
    try {
      const repoInfo = await git.getRepoInfo(githubEnterpriseBaseUrl);
      if (!repoInfo) {
        return undefined;
      }
      const ghClient = new GitHubClient(
        repoInfo.owner,
        repoInfo.repo,
        (message, error) => this.logService.warn(`${message} ${error}`),
        resolveGitHubHostConfig(repoInfo.host, githubEnterpriseBaseUrl)
      );
      const prs = await ghClient.listOpenPullRequests();
      const match = prs.find((pr) => pr.head?.ref === branch);
      return match ? { number: match.number, state: match.state } : undefined;
    } catch {
      // No GitHub remote/token, or an API failure — enrichment is best-effort.
      return undefined;
    }
  }
}
