// Minimal type stubs for the VS Code built-in git extension public API.
// Source: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts

export const enum RefType {
  Head = 0,
  RemoteHead = 1,
  Tag = 2,
}

export interface Ref {
  readonly type: RefType;
  /** Branch name (local/remote) or tag name */
  readonly name?: string;
  readonly commit?: string;
  /** Set only for RefType.RemoteHead — the remote alias, e.g. "origin" */
  readonly remote?: string;
}

export interface RepositoryState {
  readonly HEAD: Ref | undefined;
  readonly refs: Ref[];
}

export interface RefQuery {
  readonly contains?: string;
  readonly count?: number;
  readonly pattern?: string | string[];
  readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

export interface Repository {
  readonly rootUri: { readonly fsPath: string };
  readonly state: RepositoryState;
  getRefs(query: RefQuery, cancellationToken?: unknown): Promise<Ref[]>;
}

export interface API {
  readonly repositories: Repository[];
  getRepository(uri: { fsPath: string }): Repository | null;
}

export interface GitExtension {
  getAPI(version: 1): API;
}
