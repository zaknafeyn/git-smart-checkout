import * as vscode from 'vscode';

import { LoggingService } from '../../logging/loggingService';

import { IGitRef } from './types';
import type { API, Commit, GitExtension, Ref, Repository } from './vscodeGitApi';

// Numeric literals matching the RefType const enum in vscodeGitApi.d.ts.
// We cannot import const enum values at runtime from a .d.ts file.
const REF_TYPE_HEAD = 0;
const REF_TYPE_REMOTE_HEAD = 1;
const REF_TYPE_TAG = 2;

export type ApiLoader = () => API | undefined;

function defaultApiLoader(): API | undefined {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    return undefined;
  }
  try {
    return ext.exports.getAPI(1);
  } catch {
    return undefined;
  }
}

export class VscodeGitProvider {
  constructor(
    private readonly logService: LoggingService,
    private readonly apiLoader: ApiLoader = defaultApiLoader
  ) {}

  static tryCreate(logService: LoggingService, apiLoader?: ApiLoader): VscodeGitProvider | undefined {
    try {
      const provider = new VscodeGitProvider(logService, apiLoader ?? defaultApiLoader);
      if (!provider.getApi()) {
        return undefined;
      }
      return provider;
    } catch {
      return undefined;
    }
  }

  private getApi(): API | undefined {
    try {
      return this.apiLoader();
    } catch {
      return undefined;
    }
  }

  /**
   * Subscribes to state changes (HEAD, refs) across all currently-open
   * repositories, plus repositories opened later. Used to keep UI (e.g. the
   * Worktrees tree view) in sync with checkouts/commits/stashes performed
   * outside the extension (built-in Source Control view, terminal `git`).
   */
  onDidChangeAnyRepositoryState(callback: () => void): vscode.Disposable {
    const api = this.getApi();
    if (!api) {
      return new vscode.Disposable(() => undefined);
    }

    const disposables: vscode.Disposable[] = [];
    const wireRepo = (repo: Repository) => disposables.push(repo.state.onDidChange(callback));

    api.repositories.forEach(wireRepo);
    disposables.push(api.onDidOpenRepository(wireRepo));

    return vscode.Disposable.from(...disposables);
  }

  private findRepo(repoPath: string) {
    const api = this.getApi();
    if (!api) {
      return undefined;
    }
    return api.repositories.find((r) => r.rootUri.fsPath === repoPath);
  }

  async getRefsForRepo(repoPath: string): Promise<IGitRef[] | undefined> {
    try {
      const repo = this.findRepo(repoPath);
      if (!repo) {
        return undefined;
      }
      const refs = await repo.getRefs({ sort: 'committerdate' });
      return refs
        .map((ref) => this.mapRef(ref))
        .filter((ref): ref is IGitRef => ref !== undefined);
    } catch (err) {
      this.logService.error(`VscodeGitProvider.getRefsForRepo failed: ${err}`);
      return undefined;
    }
  }

  /**
   * Enrich a single ref with commit details (and ahead/behind for local branches)
   * using the VS Code Git API only — no child git processes. Returns a partial
   * IGitRef containing only the fields that could be resolved; never throws.
   */
  async getRefDetails(repoPath: string, ref: IGitRef): Promise<Partial<IGitRef>> {
    const repo = this.findRepo(repoPath);
    if (!repo) {
      return {};
    }

    const result: Partial<IGitRef> = {};

    // Commit-ish to resolve. For tags use the name (annotated tags carry a tag
    // object SHA in `hash`, which getCommit can't resolve); for branches prefer
    // the resolved hash, falling back to the (full) ref name.
    const commitRef = ref.isTag
      ? ref.name
      : ref.hash ?? (ref.remote ? ref.fullName : ref.name);

    try {
      const commit = await repo.getCommit(commitRef);
      Object.assign(result, this.mapCommit(commit));
    } catch (err) {
      this.logService.error(
        `VscodeGitProvider.getRefDetails getCommit(${commitRef}) failed: ${err}`
      );
    }

    // ahead/behind is only meaningful for a local branch.
    if (!ref.isTag && !ref.remote) {
      try {
        const branch = await repo.getBranch(ref.name);
        if (typeof branch.ahead === 'number' || typeof branch.behind === 'number') {
          result.parsedUpstreamTrack = [branch.ahead ?? 0, branch.behind ?? 0];
        }
      } catch (err) {
        this.logService.error(
          `VscodeGitProvider.getRefDetails getBranch(${ref.name}) failed: ${err}`
        );
      }
    }

    return result;
  }

  private mapCommit(commit: Commit): Partial<IGitRef> {
    const date = commit.commitDate ?? commit.authorDate;
    return {
      hash: commit.hash ? commit.hash.slice(0, 7) : undefined,
      comment: commit.message ? commit.message.split('\n', 1)[0] : undefined,
      authorName: commit.authorName ?? '',
      committerDate: date ? String(Math.floor(date.getTime() / 1000)) : undefined,
    };
  }

  async rebase(repoPath: string, target: string): Promise<boolean> {
    const repo = this.findRepo(repoPath);
    if (!repo) {
      return false;
    }
    await repo.rebase(target);
    return true;
  }

  getCurrentBranch(repoPath: string): string | undefined {
    try {
      const repo = this.findRepo(repoPath);
      return repo?.state.HEAD?.name;
    } catch {
      return undefined;
    }
  }

  private mapRef(ref: Ref): IGitRef | undefined {
    const { type, name, commit, remote } = ref;

    if (!name || name === 'HEAD') {
      return undefined;
    }

    if (type === REF_TYPE_REMOTE_HEAD) {
      if (!remote) {
        return undefined;
      }
      // name = "origin/main", remote = "origin" → branchName = "main"
      const branchName = name.slice(remote.length + 1);
      if (!branchName) {
        return undefined;
      }
      return {
        name: branchName,
        fullName: name,
        remote,
        hash: commit,
        authorName: '',
      };
    }

    if (type === REF_TYPE_TAG) {
      return {
        name,
        fullName: name,
        isTag: true,
        hash: commit,
        authorName: '',
      };
    }

    if (type === REF_TYPE_HEAD) {
      return {
        name,
        fullName: name,
        hash: commit,
        authorName: '',
      };
    }

    return undefined;
  }
}
