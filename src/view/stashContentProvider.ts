import * as vscode from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';
import { getStashFileContent, StashDiffSide } from '../services/stashService';

/** Scheme backing the Stashes tree's per-file diff (`vscode.diff(gscStash:..., gscStash:..., ...)`). */
export const STASH_URI_SCHEME = 'gsc-stash';

interface StashUriQuery {
  repositoryPath: string;
  hash: string;
  filePath: string;
  side: StashDiffSide;
}

/**
 * Builds a `gsc-stash:` URI identifying one side of a stashed file's diff. The path component is
 * only for a readable tab/editor title; `StashContentProvider` reads everything it needs from the
 * query, since a stash hash or repository path could itself contain characters that would be
 * ambiguous to parse back out of a plain `hash^:path` string.
 */
export function stashFileUri(
  repositoryPath: string,
  hash: string,
  filePath: string,
  side: StashDiffSide
): vscode.Uri {
  const query: StashUriQuery = { repositoryPath, hash, filePath, side };
  return vscode.Uri.from({
    scheme: STASH_URI_SCHEME,
    path: `/${filePath}`,
    query: JSON.stringify(query),
  });
}

/** Resolves `gsc-stash:` URIs (see `stashFileUri`) to file content via `GitExecutor.getFileAtRev`. */
export class StashContentProvider implements vscode.TextDocumentContentProvider {
  constructor(
    private readonly logService: LoggingService,
    private readonly vscodeGitProvider?: VscodeGitProvider
  ) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const { repositoryPath, hash, filePath, side } = JSON.parse(uri.query) as StashUriQuery;
      const git = new GitExecutor(repositoryPath, this.logService, this.vscodeGitProvider);
      return await getStashFileContent(git, hash, filePath, side);
    } catch (error) {
      this.logService.warn(`Failed to load stash file content for ${uri.toString()}: ${error}`);
      return '';
    }
  }
}
