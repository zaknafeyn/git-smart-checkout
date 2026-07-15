import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_AND_POP_IN_NEW_BRANCH, AUTO_STASH_CURRENT_BRANCH } from '../../commands/checkoutToCommand/constants';
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
    isStashWithMessageExists: async () => true,
    popStash: async () => { throw new Error('conflict during pop'); },
    getConflictedFiles: async () => [],
    isMergeInProgress: async () => false,
    isCherryPickInProgress: async () => false,
    resetMerge: async () => {},
    ...overrides,
  } as unknown as GitExecutor;
}

function makeConfigManagerStub(): ConfigurationManager {
  return {
    get: () => ({ pullAfterCheckout: 'ffOnly' }),
  } as unknown as ConfigurationManager;
}

describe('AutoStashService — conflict rescue routing', () => {
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

  afterEach(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  it('AUTO_STASH_AND_POP_IN_NEW_BRANCH: 3 conflicted files → rescue notification, no throw, outcome "rescued"', async () => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    const warnings: string[] = [];
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };

    const git = makeGitStub({ getConflictedFiles: async () => ['a.txt', 'b.txt', 'c.txt'] });
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(git, 'main', nextBranch, AUTO_STASH_AND_POP_IN_NEW_BRANCH);

    assert.strictEqual(outcome, 'rescued');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Stash restored with conflicts: 3 file\(s\) need resolution/);
  });

  it('AUTO_STASH_AND_POP_IN_NEW_BRANCH: no conflicted files → generic error path preserved', async () => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async () => undefined;

    const git = makeGitStub({ getConflictedFiles: async () => [] });
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    await assert.rejects(
      () => service.checkoutAndStashChanges(git, 'main', nextBranch, AUTO_STASH_AND_POP_IN_NEW_BRANCH),
      /Failed to pop the stash on the new branch/
    );
  });

  it('AUTO_STASH_CURRENT_BRANCH: conflicted pop on the new branch → rescue notification, no throw, outcome "rescued"', async () => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    const warnings: string[] = [];
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };

    const git = makeGitStub({ getConflictedFiles: async () => ['a.txt'] });
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(git, 'main', nextBranch, AUTO_STASH_CURRENT_BRANCH);

    assert.strictEqual(outcome, 'rescued');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Stash restored with conflicts: 1 file\(s\) need resolution/);
  });

  it('AUTO_STASH_CURRENT_BRANCH: no conflicted files → generic error path preserved', async () => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async () => undefined;

    const git = makeGitStub({ getConflictedFiles: async () => [] });
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    await assert.rejects(
      () => service.checkoutAndStashChanges(git, 'main', nextBranch, AUTO_STASH_CURRENT_BRANCH),
      /Failed to pop the stash on the new branch/
    );
  });

  it('apply mode: rescue wording says stash preserved because apply never removes it', async () => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    const warnings: string[] = [];
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };

    const git = makeGitStub({ getConflictedFiles: async () => ['a.txt'] });
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.doAutoStashAndPopInNewBranch(git, 'main', 'feature-x', true, true, 'feature-x');

    assert.strictEqual(outcome, 'rescued');
    assert.match(warnings[0], /preserved because apply never removes it/);
  });
});
