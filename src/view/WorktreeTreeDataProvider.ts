import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitWorktree, TUpstreamTrack } from '../common/git/types';
import { LoggingService } from '../logging/loggingService';
import { PRReviewWorktreeStore } from '../services/prReviewWorktreeStore';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';

export interface WorktreeEnrichment {
  isDirty: boolean;
  dirtyFileCount: number;
  track?: TUpstreamTrack;
  isPrReview: boolean;
}

export class WorktreeTreeItem extends vscode.TreeItem {
  public readonly branch: string | undefined;
  public readonly isMain: boolean;
  public readonly isDetached: boolean;

  constructor(
    public readonly worktree: IGitWorktree,
    public readonly repositoryPath: string,
    isMain: boolean,
    enrichment?: WorktreeEnrichment
  ) {
    const branch = worktree.branch?.replace(/^refs\/heads\//, '');
    super(branch || worktree.head?.slice(0, 8) || 'Detached HEAD', vscode.TreeItemCollapsibleState.None);
    this.branch = branch;
    this.isMain = isMain;
    this.isDetached = !branch;
    this.command = {
      command: 'git-smart-checkout.worktree.open',
      title: 'Open Worktree',
      arguments: [worktree.path, repositoryPath],
    };
    this.applyEnrichment(enrichment);
  }

  /** Updates description, tooltip, icon and contextValue from freshly-loaded state. */
  applyEnrichment(enrichment?: WorktreeEnrichment): void {
    const shortened = this.worktree.path.startsWith(os.homedir())
      ? `~${this.worktree.path.slice(os.homedir().length)}`
      : this.worktree.path;
    const arrows = enrichment?.track ? `⇡${enrichment.track[0]} ⇣${enrichment.track[1]}` : '';
    this.description = [
      shortened,
      arrows,
      enrichment?.isDirty ? '●' : '',
      enrichment?.isPrReview ? 'PR review' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const lines = [
      this.worktree.path,
      this.branch ? `Branch: ${this.branch}` : 'Detached HEAD',
      enrichment?.track
        ? `Upstream: ⇡${enrichment.track[0]} ahead, ⇣${enrichment.track[1]} behind`
        : 'Upstream: none',
      enrichment
        ? `Dirty files: ${enrichment.dirtyFileCount}`
        : 'Dirty files: (loading...)',
      this.isMain ? 'Source: main worktree' : 'Source: linked worktree',
    ];
    if (enrichment?.isPrReview) {
      lines.push('Tracked as a PR-review worktree');
    }
    this.tooltip = lines.join('\n');

    const tags = ['worktree', this.isMain ? 'main' : 'linked'];
    if (this.isDetached) {
      tags.push('detached');
    }
    if (enrichment) {
      tags.push(enrichment.isDirty ? 'dirty' : 'clean');
      if (enrichment.isPrReview) {
        tags.push('prReview');
      }
    }
    this.contextValue = tags.join(' ');

    this.iconPath = new vscode.ThemeIcon(
      enrichment?.isPrReview ? 'git-pull-request' : this.isMain ? 'repo' : 'folder-library'
    );
  }
}

export class WorktreeRepositoryTreeItem extends vscode.TreeItem {
  constructor(public readonly repositoryPath: string, public readonly children: WorktreeTreeItem[]) {
    super(path.basename(repositoryPath) || repositoryPath, vscode.TreeItemCollapsibleState.Expanded);
    this.description = repositoryPath;
    this.contextValue = 'worktree.repository';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

type WorktreeNode = WorktreeTreeItem | WorktreeRepositoryTreeItem;

const DEFAULT_DEBOUNCE_MS = 2000;

export class WorktreeTreeDataProvider implements vscode.TreeDataProvider<WorktreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<WorktreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private items: WorktreeTreeItem[] = [];
  private repositories: WorktreeRepositoryTreeItem[] = [];
  private loaded = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly logService: LoggingService,
    private readonly store: PRReviewWorktreeStore,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {}

  getTreeItem(item: WorktreeNode): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: WorktreeRepositoryTreeItem): Promise<WorktreeNode[]> {
    if (!this.loaded) {
      await this.load();
    }
    if (element) {
      return element.children;
    }
    if (this.repositories.length > 1) {
      return this.repositories;
    }
    return this.items;
  }

  /** Reloads immediately. Used for explicit user-triggered refreshes. */
  refresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.loaded = false;
    this.items = [];
    this.repositories = [];
    this.changeEmitter.fire(undefined);
  }

  /**
   * Coalesces bursts of change notifications (e.g. rapid window focus events,
   * several worktree-mutating commands run back to back) into a single
   * reload after `delayMs` of quiet.
   */
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

  /**
   * Phase 1: builds tree items immediately from `worktreeListDetailed` only
   * (no git calls beyond that single listing), so the view populates fast.
   * Phase 2 (`enrich`) fills in dirty/ahead-behind/PR-review state
   * asynchronously and fires a per-item change event as each resolves.
   */
  private async load(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const loaded: WorktreeTreeItem[] = [];
    const grouped = new Map<string, WorktreeTreeItem[]>();
    const enrichmentTasks: Array<() => Promise<void>> = [];

    for (const folder of folders) {
      try {
        const repositoryPath = await resolveGitRepositoryRoot(folder.uri.fsPath, this.logService);
        const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
        const worktrees = await git.worktreeListDetailed(true);
        const visibleWorktrees = worktrees.filter((item) => !item.bare && !item.prunable);

        visibleWorktrees.forEach((worktree, index) => {
          // git worktree list always reports the main worktree first.
          const isMain = index === 0;
          const item = new WorktreeTreeItem(worktree, repositoryPath, isMain);
          loaded.push(item);
          const repoItems = grouped.get(repositoryPath) ?? [];
          repoItems.push(item);
          grouped.set(repositoryPath, repoItems);

          enrichmentTasks.push(() => this.enrichItem(item, git, repositoryPath));
        });
      } catch (error) {
        this.logService.warn(`Failed to load worktrees for ${folder.uri.fsPath}: ${error}`);
      }
    }

    this.items = loaded;
    this.repositories = [...grouped.entries()].map(
      ([repositoryPath, children]) => new WorktreeRepositoryTreeItem(repositoryPath, children)
    );
    this.loaded = true;

    // Fire-and-forget: enrichment must not block the initial render.
    void Promise.all(enrichmentTasks.map((task) => task()));
  }

  private async enrichItem(
    item: WorktreeTreeItem,
    git: GitExecutor,
    repositoryPath: string
  ): Promise<void> {
    try {
      const [dirtyFileCount, refs, reviews] = await Promise.all([
        new GitExecutor(item.worktree.path, this.logService, this.vscodeGitProvider).getDirtyFileCount(),
        git.getAllRefListExtended(),
        this.store.getForRepository({ repoKey: repositoryPath, repositoryPath }),
      ]);
      const ref = item.branch ? refs.find((entry) => !entry.remote && entry.name === item.branch) : undefined;
      const isPrReview = reviews.some(
        (review) => path.resolve(review.worktreePath) === path.resolve(item.worktree.path)
      );

      item.applyEnrichment({
        isDirty: dirtyFileCount !== 0,
        dirtyFileCount,
        track: ref?.parsedUpstreamTrack,
        isPrReview,
      });
    } catch (error) {
      this.logService.warn(`Failed to enrich worktree ${item.worktree.path}: ${error}`);
      item.applyEnrichment({ isDirty: false, dirtyFileCount: 0, isPrReview: false });
    }
    this.changeEmitter.fire(item);
  }
}
