import * as vscode from 'vscode';

import { LoggingService } from '../../logging/loggingService';

import { IGitRef } from './types';
import type { API, GitExtension, Ref } from './vscodeGitApi';

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
      const refs = await repo.getRefs({ sort: 'alphabetically' });
      return refs
        .map((ref) => this.mapRef(ref))
        .filter((ref): ref is IGitRef => ref !== undefined);
    } catch (err) {
      this.logService.error(`VscodeGitProvider.getRefsForRepo failed: ${err}`);
      return undefined;
    }
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
