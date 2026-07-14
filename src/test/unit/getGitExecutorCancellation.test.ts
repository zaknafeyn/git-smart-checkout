import * as assert from 'assert';
import * as vscode from 'vscode';

import * as commonVscode from '../../common/vscode';
import { getGitExecutor } from '../../utils/getGitExecutor';
import { UserCancelledError } from '../../utils/userCancelledError';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('getGitExecutor multi-root repository picker cancellation', () => {
  it('throws UserCancelledError (not a plain Error) when the repository picker is dismissed', async () => {
    const originalGetFolders = commonVscode.getWorkspaceFoldersFormatted;
    const originalShowQuickPick = vscode.window.showQuickPick;

    (commonVscode as unknown as { getWorkspaceFoldersFormatted: () => unknown }).getWorkspaceFoldersFormatted =
      () => [
        { name: 'repo-a', path: '/tmp/gsc-repo-a' },
        { name: 'repo-b', path: '/tmp/gsc-repo-b' },
      ];
    (vscode.window as unknown as { showQuickPick: () => Promise<undefined> }).showQuickPick = async () =>
      undefined;

    try {
      await assert.rejects(
        () => getGitExecutor(mockLogService),
        (error: unknown) => error instanceof UserCancelledError
      );
    } finally {
      (
        commonVscode as unknown as { getWorkspaceFoldersFormatted: typeof originalGetFolders }
      ).getWorkspaceFoldersFormatted = originalGetFolders;
      (vscode.window as unknown as { showQuickPick: typeof originalShowQuickPick }).showQuickPick =
        originalShowQuickPick;
    }
  });
});
