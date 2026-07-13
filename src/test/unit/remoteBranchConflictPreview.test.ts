import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_AND_POP_IN_NEW_BRANCH } from '../../commands/checkoutToCommand/constants';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const remoteOnlyBranch: IGitRef = {
  name: 'feature-x',
  fullName: 'origin/feature-x',
  remote: 'origin',
  isTag: false,
} as unknown as IGitRef;

const localBranch: IGitRef = {
  name: 'feature-x',
  fullName: 'feature-x',
  remote: false,
  isTag: false,
} as unknown as IGitRef;

function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    isWorkdirHasChanges: async () => true,
    getStashConflictPreview: async () => [],
    createStash: async () => {},
    checkout: async () => {},
    hasUpstreamBranch: async () => false,
    isStashWithMessageExists: async () => false,
    popStash: async () => {},
    ...overrides,
  } as unknown as GitExecutor;
}

describe('AutoStashService conflict preview ref resolution', () => {
  it('uses the fully-qualified remote ref (not the bare branch name) when previewing conflicts for a remote-only branch', async () => {
    const previewCalls: string[] = [];
    const git = makeGitStub({
      getStashConflictPreview: (async (ref: string) => {
        previewCalls.push(ref);
        return ['conflicting-file.ts'];
      }) as unknown as GitExecutor['getStashConflictPreview'],
    });

    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    let warningShown = false;
    (vscode.window as any).showWarningMessage = async () => {
      warningShown = true;
      return 'Continue';
    };

    try {
      const service = new AutoStashService({} as ConfigurationManager, mockLogService);
      const outcome = await service.checkoutAndStashChanges(
        git,
        'main',
        remoteOnlyBranch,
        AUTO_STASH_AND_POP_IN_NEW_BRANCH
      );

      assert.deepStrictEqual(previewCalls, ['origin/feature-x']);
      assert.strictEqual(warningShown, true, 'conflict-confirmation dialog should be shown when conflicts are returned');
      assert.strictEqual(outcome, 'completed');
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('uses the plain branch name when previewing conflicts for a local branch (no behavior change)', async () => {
    const previewCalls: string[] = [];
    const git = makeGitStub({
      getStashConflictPreview: (async (ref: string) => {
        previewCalls.push(ref);
        return [];
      }) as unknown as GitExecutor['getStashConflictPreview'],
    });

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);
    const outcome = await service.checkoutAndStashChanges(
      git,
      'main',
      localBranch,
      AUTO_STASH_AND_POP_IN_NEW_BRANCH
    );

    assert.deepStrictEqual(previewCalls, ['feature-x']);
    assert.strictEqual(outcome, 'completed');
  });
});
