import {
  ExtensionContext,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  commands,
  EventEmitter,
  Event,
  Uri,
} from 'vscode';
import { LoggingService } from '../logging/loggingService';
import { GitHubCommit, GitHubCommitFile } from '../types/dataTypes';

export class CommitTreeItem extends TreeItem {
  constructor(
    public readonly commit: GitHubCommit,
    public readonly isSelected: boolean,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(commit.commit.message.split('\n')[0], collapsibleState);
    
    this.id = commit.sha;
    this.contextValue = 'commit';
    this.iconPath = new ThemeIcon('git-commit');
    this.tooltip = `${commit.commit.message}\nSHA: ${commit.sha}`;
    this.checkboxState = isSelected ? 1 : 0; // 0 = unchecked, 1 = checked
    
    // Add merge badge to description
    if (commit.parents.length > 1) {
      this.description = 'MERGE';
    }
  }
}

export class FileTreeItem extends TreeItem {
  constructor(
    public readonly file: GitHubCommitFile,
    public readonly collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {
    super(file.filename, collapsibleState);
    
    this.id = `${file.filename}-${file.status}`;
    this.contextValue = 'file';
    this.tooltip = `${file.filename}\nStatus: ${file.status}\n+${file.additions} -${file.deletions}`;
    this.description = this.getStatusDescription(file);
  }

  private getStatusDescription(file: GitHubCommitFile): string {
    const statusChar = this.getStatusChar(file.status);
    const stats = this.getStatsString(file);
    return `${statusChar} ${stats}`;
  }

  private getStatusChar(status: string): string {
    switch (status) {
      case 'added': return 'A';
      case 'modified': return 'M';
      case 'removed': return 'D';
      case 'renamed': return 'R';
      default: return 'M';
    }
  }

  private getStatsString(file: GitHubCommitFile): string {
    const parts = [];
    if (file.additions > 0) {parts.push(`+${file.additions}`);}
    if (file.deletions > 0) {parts.push(`-${file.deletions}`);}
    return parts.join(' ');
  }
}

export class PrCommitsTreeProvider implements TreeDataProvider<CommitTreeItem | FileTreeItem> {
  private commits: GitHubCommit[] = [];
  private selectedCommits: string[] = [];
  private static readonly STORAGE_KEY = 'pr-commits-tree-state';

  private _onDidChangeTreeData: EventEmitter<CommitTreeItem | FileTreeItem | undefined | null | void> = new EventEmitter<CommitTreeItem | FileTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<CommitTreeItem | FileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private context: ExtensionContext,
    private loggingService: LoggingService
  ) {
    this.loadPersistedState();
  }

  private loadPersistedState() {
    try {
      const workspaceState = this.context.workspaceState;
      const savedState = workspaceState.get<{commits: GitHubCommit[], selectedCommits: string[]}>(PrCommitsTreeProvider.STORAGE_KEY);
      
      if (savedState) {
        this.commits = savedState.commits || [];
        this.selectedCommits = savedState.selectedCommits || [];
      }
    } catch (error) {
      this.loggingService.warn(`Failed to load persisted commits state: ${error}`);
    }
  }

  private savePersistedState() {
    try {
      const workspaceState = this.context.workspaceState;
      const stateToSave = {
        commits: this.commits,
        selectedCommits: this.selectedCommits
      };
      workspaceState.update(PrCommitsTreeProvider.STORAGE_KEY, stateToSave);
    } catch (error) {
      this.loggingService.warn(`Failed to save commits state: ${error}`);
    }
  }

  getTreeItem(element: CommitTreeItem | FileTreeItem): TreeItem {
    return element;
  }

  getChildren(element?: CommitTreeItem | FileTreeItem): Thenable<(CommitTreeItem | FileTreeItem)[]> {
    if (!element) {
      // Root level - return commits
      return Promise.resolve(
        this.commits.map(commit => {
            const item = new CommitTreeItem(
              commit,
              this.selectedCommits.includes(commit.sha),
              commit.files && commit.files.length > 0 
                ? TreeItemCollapsibleState.Collapsed 
                : TreeItemCollapsibleState.None
            );
            return item;
          }
        )
      );
    }

    if (element instanceof CommitTreeItem) {
      // Return files for this commit
      const files = element.commit.files || [];
      return Promise.resolve(
        files.map(file => {
          const item = new FileTreeItem(file);
          item.resourceUri = Uri.file(file.filename);
          return item;
        })
      );
    }

    // File items have no children
    return Promise.resolve([]);
  }

  public updateCommits(commits: GitHubCommit[]) {
    this.commits = commits;
    this.loggingService.debug("Commits: ", commits);
    
    // Auto-select non-merge commits (unselect merge commits by default)
    this.selectedCommits = commits
      .filter(commit => commit.parents.length <= 1) // Only non-merge commits
      .map(commit => commit.sha);
    
    this.savePersistedState();
    this._onDidChangeTreeData.fire();
    this.sendSelectedCommits();
  }

  public handleCommitToggle(sha: string) {
    if (this.selectedCommits.includes(sha)) {
      this.selectedCommits = this.selectedCommits.filter(s => s !== sha);
    } else {
      this.selectedCommits = [...this.selectedCommits, sha];
    }
    this.savePersistedState();
    this._onDidChangeTreeData.fire();
    this.sendSelectedCommits();
  }

  private sendSelectedCommits() {
    // Send selected commits to main webview
    commands.executeCommand('git-smart-checkout.updateSelectedCommits', this.selectedCommits);
  }

  public getSelectedCommits(): string[] {
    return this.selectedCommits;
  }
}
