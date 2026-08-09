import { formatDistanceToNow } from 'date-fns';
import * as vscode from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { IGitStash } from '../common/git/types';
import { LoggingService } from '../logging/loggingService';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { resolveGitRepositoryRoot } from '../utils/getGitExecutor';
import { groupStashes, isStashStale } from '../services/stashService';
import { stashFileUri } from './stashContentProvider';

export type StashGroupKind = 'auto' | 'other';

export class StashGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: StashGroupKind,
    public readonly repositoryPath: string,
    public readonly stashes: IGitStash[]
  ) {
    super(
      kind === 'auto' ? `Auto-stashes (${stashes.length})` : `Other stashes (${stashes.length})`,
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = kind === 'auto' ? 'stashGroup autoStashes' : 'stashGroup otherStashes';
    this.iconPath = new vscode.ThemeIcon(kind === 'auto' ? 'archive' : 'inbox');
  }
}

export class StashTreeItem extends vscode.TreeItem {
  public readonly isStale: boolean;

  constructor(
    public readonly stash: IGitStash,
    public readonly repositoryPath: string,
    staleAfterDays: number
  ) {
    super(stash.sourceBranch ?? stash.message, vscode.TreeItemCollapsibleState.Collapsed);
    this.isStale = isStashStale(stash, staleAfterDays);

    const age = formatDistanceToNow(stash.timestamp * 1000, { addSuffix: true });
    const fileCount = `${stash.files.length} ${stash.files.length === 1 ? 'file' : 'files'}`;
    this.description = [age, '•', fileCount, this.isStale ? '⚠ stale' : ''].filter(Boolean).join(' ');

    this.tooltip = [
      stash.message,
      `Branch: ${stash.sourceBranch ?? 'unknown'}`,
      `Created: ${formatDistanceToNow(stash.timestamp * 1000, { addSuffix: true })}`,
      `Files: ${stash.files.length > 0 ? stash.files.join(', ') : '(none)'}`,
      this.isStale ? '⚠ Older than the configured staleness threshold.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.iconPath = new vscode.ThemeIcon('circle-filled');
    this.contextValue = 'stash';
  }
}

export class StashFileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly stash: IGitStash,
    public readonly repositoryPath: string,
    public readonly filePath: string,
    status: string
  ) {
    super(`${status} ${filePath}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'stashFile';
    this.iconPath = vscode.ThemeIcon.File;
    this.resourceUri = vscode.Uri.file(filePath);
    this.command = {
      command: 'vscode.diff',
      title: 'Open Diff',
      arguments: [
        stashFileUri(repositoryPath, stash.hash, filePath, 'before'),
        stashFileUri(repositoryPath, stash.hash, filePath, 'after'),
        `${filePath} (stash @ ${stash.sourceBranch ?? stash.message})`,
      ],
    };
  }
}

export type StashNode = StashGroupTreeItem | StashTreeItem | StashFileTreeItem;

const DEFAULT_DEBOUNCE_MS = 2000;

export class StashTreeDataProvider implements vscode.TreeDataProvider<StashNode> {
  private readonly changeEmitter = new vscode.EventEmitter<StashNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private groups: StashGroupTreeItem[] = [];
  private loaded = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly logService: LoggingService,
    /** Read lazily (rather than captured once) so a live config change takes effect on next reload. */
    private readonly getStaleAfterDays: () => number,
    private readonly vscodeGitProvider?: VscodeGitProvider,
    private readonly onAutoStashCountChanged?: (autoStashCount: number) => void
  ) {}

  getTreeItem(item: StashNode): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: StashNode): Promise<StashNode[]> {
    if (!this.loaded) {
      await this.load();
    }
    if (!element) {
      return this.groups;
    }
    if (element instanceof StashGroupTreeItem) {
      return element.stashes.map(
        (stash) => new StashTreeItem(stash, element.repositoryPath, this.getStaleAfterDays())
      );
    }
    if (element instanceof StashTreeItem) {
      return this.loadFiles(element);
    }
    return [];
  }

  /** Reloads immediately. Used for explicit user-triggered refreshes and after mutations. */
  refresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.loaded = false;
    this.groups = [];
    this.changeEmitter.fire(undefined);
  }

  /**
   * Coalesces bursts of change notifications (several stash mutations run back to back, rapid
   * window focus events) into a single reload after `delayMs` of quiet.
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

  private async loadFiles(item: StashTreeItem): Promise<StashFileTreeItem[]> {
    try {
      const git = new GitExecutor(item.repositoryPath, this.logService, this.vscodeGitProvider);
      const files = await git.getStashFilesWithStatus(item.stash.selector);
      return files.map(
        (file) => new StashFileTreeItem(item.stash, item.repositoryPath, file.path, file.status)
      );
    } catch (error) {
      this.logService.warn(`Failed to load files for stash ${item.stash.selector}: ${error}`);
      return [];
    }
  }

  /**
   * Loads every workspace-folder repository's stashes and groups them into "Auto-stashes" /
   * "Other stashes" (this view manages all stashes, not just auto-stashes). Single pass — unlike
   * `WorktreeTreeDataProvider`, there's no separate enrichment phase, since `listStashes()` (used
   * for both grouping and the per-stash summary) already returns everything the group/stash rows
   * need; only the file-status breakdown is deferred, loaded lazily when a stash node expands.
   */
  private async load(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const groups: StashGroupTreeItem[] = [];
    let autoStashCount = 0;

    for (const folder of folders) {
      try {
        const repositoryPath = await resolveGitRepositoryRoot(folder.uri.fsPath, this.logService);
        const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
        const stashes = await git.listStashes();
        const { autoStashes, otherStashes } = groupStashes(stashes);

        autoStashCount += autoStashes.length;
        if (autoStashes.length > 0) {
          groups.push(new StashGroupTreeItem('auto', repositoryPath, autoStashes));
        }
        if (otherStashes.length > 0) {
          groups.push(new StashGroupTreeItem('other', repositoryPath, otherStashes));
        }
      } catch (error) {
        this.logService.warn(`Failed to load stashes for ${folder.uri.fsPath}: ${error}`);
      }
    }

    this.groups = groups;
    this.loaded = true;
    this.onAutoStashCountChanged?.(autoStashCount);
  }
}
