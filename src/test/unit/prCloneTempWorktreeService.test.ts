import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitExecutor } from '../../common/git/gitExecutor';
import { GitHubClient } from '../../common/api/ghClient';
import { EXTENSION_NAME } from '../../const';
import {
  isExistingExtensionTempWorktree,
  PrCloneTempWorktreeService,
} from '../../services/prCloneTempWorktreeService';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('PrCloneTempWorktreeService cleanup', () => {
  it('prunes stale metadata and still removes existing extension worktrees', async () => {
    const existing = fs.mkdtempSync(
      path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-test-`)
    );
    const missing = path.join(
      os.tmpdir(),
      `${EXTENSION_NAME}-pr-clone-missing-${Date.now()}`
    );
    const calls: string[] = [];
    const git = {
      worktreePrune: async () => {
        calls.push('prune');
      },
      worktreeList: async () => {
        calls.push('list');
        return [missing, existing];
      },
      worktreeRemove: async (worktree: string) => {
        calls.push(`remove:${worktree}`);
      },
    } as unknown as GitExecutor;

    const service = new PrCloneTempWorktreeService(
      git,
      {} as GitHubClient,
      mockLogService
    );

    try {
      await (service as any).cleanupOtherTempWorktrees();
      assert.deepStrictEqual(calls, ['prune', 'list', `remove:${existing}`]);
      assert.strictEqual(isExistingExtensionTempWorktree(missing, os.tmpdir()), false);
    } finally {
      fs.rmSync(existing, { recursive: true, force: true });
    }
  });

  it('still prunes other worktrees when unregistering the current one fails', async () => {
    const tempPath = fs.mkdtempSync(
      path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-current-`)
    );
    const calls: string[] = [];
    const git = {
      worktreeRemove: async () => {
        calls.push('remove-current');
        throw new Error('stale registration');
      },
      worktreePrune: async () => {
        calls.push('prune');
      },
      worktreeList: async () => {
        calls.push('list');
        return [];
      },
    } as unknown as GitExecutor;

    const service = new PrCloneTempWorktreeService(
      git,
      {} as GitHubClient,
      mockLogService
    );

    await (service as any).cleanupTempWorktree(tempPath);

    assert.deepStrictEqual(calls, ['remove-current', 'prune', 'list']);
    assert.strictEqual(fs.existsSync(tempPath), false);
  });
});
