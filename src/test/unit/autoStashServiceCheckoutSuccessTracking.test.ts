import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../../commands/checkoutToCommand/constants';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const nextBranch: IGitRef = {
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

function makeConfigManagerStub(): ConfigurationManager {
  return {
    get: () => ({ pullAfterCheckout: 'ffOnly' }),
  } as unknown as ConfigurationManager;
}

describe('AutoStashService checkout-success tracking (what\'s-new feedback counter)', () => {
  it('invokes the callback for a completed stash-carrying checkout (AUTO_STASH_CURRENT_BRANCH)', async () => {
    let callCount = 0;
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService, () => { callCount++; });

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub(),
      'main',
      nextBranch,
      AUTO_STASH_CURRENT_BRANCH
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(callCount, 1);
  });

  it('invokes the callback for a completed stash-carrying checkout (AUTO_STASH_AND_POP_IN_NEW_BRANCH)', async () => {
    let callCount = 0;
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService, () => { callCount++; });

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub(),
      'main',
      nextBranch,
      AUTO_STASH_AND_POP_IN_NEW_BRANCH
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(callCount, 1);
  });

  it('does not invoke the callback when the checkout is cancelled (conflict warning rejected)', async () => {
    let callCount = 0;
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService, () => { callCount++; });

    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    (vscode.window as any).showWarningMessage = async () => undefined;

    try {
      const outcome = await service.checkoutAndStashChanges(
        makeGitStub({ getStashConflictPreview: async () => ['file.ts'] }),
        'main',
        nextBranch,
        AUTO_STASH_AND_POP_IN_NEW_BRANCH
      );

      assert.strictEqual(outcome, 'cancelled');
      assert.strictEqual(callCount, 0);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  it('does not invoke the callback when there were no changes to stash', async () => {
    let callCount = 0;
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService, () => { callCount++; });

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub({ isWorkdirHasChanges: async () => false }),
      'main',
      nextBranch,
      AUTO_STASH_AND_POP_IN_NEW_BRANCH
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(callCount, 0);
  });

  it('does not invoke the callback for AUTO_STASH_IGNORE (no stash is ever carried)', async () => {
    let callCount = 0;
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService, () => { callCount++; });

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub(),
      'main',
      nextBranch,
      AUTO_STASH_IGNORE
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(callCount, 0);
  });

  it('does not throw when no callback is provided', async () => {
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub(),
      'main',
      nextBranch,
      AUTO_STASH_CURRENT_BRANCH
    );

    assert.strictEqual(outcome, 'completed');
  });
});
