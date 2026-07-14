import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitWorktree } from '../common/git/types';
import { LoggingService } from '../logging/loggingService';
import { PRReviewWorktreeStore } from '../services/prReviewWorktreeStore';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';

export class WorktreeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: IGitWorktree,
    public readonly repositoryPath: string,
    isDirty: boolean,
    track?: [number, number],
    isPrReview = false
  ) {
    const branch = worktree.branch?.replace(/^refs\/heads\//, '');
    super(branch || worktree.head?.slice(0, 8) || 'Detached HEAD', vscode.TreeItemCollapsibleState.None);
    const shortened = worktree.path.startsWith(os.homedir())
      ? `~${worktree.path.slice(os.homedir().length)}`
      : worktree.path;
    const arrows = track ? `⇡${track[0]} ⇣${track[1]}` : '';
    this.description = [shortened, arrows, isDirty ? '●' : '', isPrReview ? 'PR review' : '']
      .filter(Boolean)
      .join(' ');
    this.tooltip = `${worktree.path}\n${branch || 'detached HEAD'}`;
    this.contextValue = isPrReview ? 'worktree.prReview' : 'worktree';
    this.iconPath = new vscode.ThemeIcon(
      isPrReview ? 'git-pull-request' : worktree.path === repositoryPath ? 'repo' : 'folder-library'
    );
    this.command = {
      command: 'vscode.openFolder',
      title: 'Open Worktree',
      arguments: [vscode.Uri.file(worktree.path), true],
    };
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

export class WorktreeTreeDataProvider implements vscode.TreeDataProvider<WorktreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<WorktreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private items: WorktreeTreeItem[] = [];
  private repositories: WorktreeRepositoryTreeItem[] = [];

  constructor(
    private readonly logService: LoggingService,
    private readonly store: PRReviewWorktreeStore,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {}

  getTreeItem(item: WorktreeNode): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: WorktreeRepositoryTreeItem): Promise<WorktreeNode[]> {
    await this.load();
    if (element) {
      return element.children;
    }
    if (this.repositories.length > 1) {
      return this.repositories;
    }
    return this.items;
  }

  refresh(): void {
    this.items = [];
    this.repositories = [];
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private async load(): Promise<void> {
    if (this.items.length > 0) {
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const loaded: WorktreeTreeItem[] = [];
    const grouped = new Map<string, WorktreeTreeItem[]>();
    for (const folder of folders) {
      try {
        const repositoryPath = await resolveGitRepositoryRoot(folder.uri.fsPath, this.logService);
        const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
        const worktrees = await git.worktreeListDetailed(true);
        const refs = await git.getAllRefListExtended();
        const reviews = await this.store.getForRepository({
          repoKey: repositoryPath,
          repositoryPath,
        });
        for (const worktree of worktrees.filter((item) => !item.bare && !item.prunable)) {
          const branch = worktree.branch?.replace(/^refs\/heads\//, '');
          const ref = branch ? refs.find((item) => !item.remote && item.name === branch) : undefined;
          const dirty = await new GitExecutor(worktree.path, this.logService, this.vscodeGitProvider).isWorkdirHasChanges();
          const isPrReview = reviews.some((review) => path.resolve(review.worktreePath) === path.resolve(worktree.path));
          const item = new WorktreeTreeItem(worktree, repositoryPath, dirty, ref?.parsedUpstreamTrack, isPrReview);
          loaded.push(item);
          const repoItems = grouped.get(repositoryPath) ?? [];
          repoItems.push(item);
          grouped.set(repositoryPath, repoItems);
        }
      } catch (error) {
        this.logService.warn(`Failed to load worktrees for ${folder.uri.fsPath}: ${error}`);
      }
    }
    this.items = loaded;
    this.repositories = [...grouped.entries()].map(
      ([repositoryPath, children]) => new WorktreeRepositoryTreeItem(repositoryPath, children)
    );
  }
}
