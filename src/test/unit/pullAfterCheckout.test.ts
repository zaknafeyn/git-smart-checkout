import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_IGNORE } from '../../commands/checkoutToCommand/constants';
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

function makeConfigManager(pullAfterCheckout: string): ConfigurationManager {
  return {
    get: () => ({ pullAfterCheckout }),
  } as unknown as ConfigurationManager;
}

function makeGitStub(overrides: Partial<GitExecutor> = {}) {
  const calls = {
    pullCurrentBranch: 0,
    pullCurrentBranchFfOnly: 0,
  };

  const git = {
    isWorkdirHasChanges: async () => false,
    createStash: async () => {},
    checkout: async () => {},
    hasUpstreamBranch: async () => true,
    isStashWithMessageExists: async () => false,
    popStash: async () => {},
    pullCurrentBranch: async () => {
      calls.pullCurrentBranch += 1;
    },
    pullCurrentBranchFfOnly: async () => {
      calls.pullCurrentBranchFfOnly += 1;
    },
    ...overrides,
  } as unknown as GitExecutor;

  return { git, calls };
}

describe('AutoStashService pull-after-checkout behavior', () => {
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let warningMessages: string[];

  beforeEach(() => {
    warningMessages = [];
    originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warningMessages.push(message);
      return undefined;
    };
  });

  afterEach(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  it('"off" never pulls even when an upstream branch exists', async () => {
    const { git, calls } = makeGitStub();
    const service = new AutoStashService(makeConfigManager('off'), mockLogService);

    const outcome = await service.doAutoStashCurrentBranch(git, 'main', 'feature-x', false);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(calls.pullCurrentBranch, 0);
    assert.strictEqual(calls.pullCurrentBranchFfOnly, 0);
  });

  it('"ffOnly" calls the ff-only pull method', async () => {
    const { git, calls } = makeGitStub();
    const service = new AutoStashService(makeConfigManager('ffOnly'), mockLogService);

    const outcome = await service.doAutoStashCurrentBranch(git, 'main', 'feature-x', false);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(calls.pullCurrentBranchFfOnly, 1);
    assert.strictEqual(calls.pullCurrentBranch, 0);
    assert.deepStrictEqual(warningMessages, []);
  });

  it('"ffOnly" shows a warning (not an error) and does not throw when the ff-only pull fails', async () => {
    const { git } = makeGitStub({
      pullCurrentBranchFfOnly: async () => {
        throw new Error('Not possible to fast-forward, aborting.');
      },
    });
    const service = new AutoStashService(makeConfigManager('ffOnly'), mockLogService);

    const outcome = await service.doAutoStashCurrentBranch(git, 'main', 'feature-x', false);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(warningMessages.length, 1);
    assert.match(warningMessages[0], /could not fast-forward/i);
  });

  it('"pull" calls the existing full-pull method (regression: matches previous default behavior)', async () => {
    const { git, calls } = makeGitStub();
    const service = new AutoStashService(makeConfigManager('pull'), mockLogService);

    const outcome = await service.doAutoStashCurrentBranch(git, 'main', 'feature-x', false);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(calls.pullCurrentBranch, 1);
    assert.strictEqual(calls.pullCurrentBranchFfOnly, 0);
  });

  it('does not pull when the branch has no upstream, regardless of mode', async () => {
    const { git, calls } = makeGitStub({ hasUpstreamBranch: async () => false });
    const service = new AutoStashService(makeConfigManager('pull'), mockLogService);

    await service.doAutoStashCurrentBranch(git, 'main', 'feature-x', false);

    assert.strictEqual(calls.pullCurrentBranch, 0);
    assert.strictEqual(calls.pullCurrentBranchFfOnly, 0);
  });

  it('applies the same pull behavior via checkoutAndStashChanges (AUTO_STASH_IGNORE path)', async () => {
    const { git, calls } = makeGitStub();
    const service = new AutoStashService(makeConfigManager('ffOnly'), mockLogService);

    const outcome = await service.checkoutAndStashChanges(
      git,
      'main',
      nextBranch,
      AUTO_STASH_IGNORE
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(calls.pullCurrentBranchFfOnly, 1);
  });
});
