import * as assert from 'assert';
import * as vscode from 'vscode';

import {
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

// The branch-owned stash for `feature-x` is the un-dated `auto-stash-<branch>`.
const EXPECTED_STASH_MESSAGE = 'auto-stash-feature-x';

interface PopCall {
  name: string;
  apply: boolean;
}

function makeGitStub(popCalls: PopCall[], overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    // Default to a clean tree — the reported scenario is returning to a branch
    // with no local changes.
    isWorkdirHasChanges: async () => false,
    getStashConflictPreview: async () => [],
    createStash: async () => {},
    checkout: async () => {},
    hasUpstreamBranch: async () => false,
    isStashWithMessageExists: async () => true,
    popStash: async (name: string, apply = false) => {
      popCalls.push({ name, apply });
    },
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

describe('AutoStashService — branch-owned auto-stash restore on return', () => {
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let infoPrompts: string[];

  beforeEach(() => {
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalShowWarningMessage = vscode.window.showWarningMessage;
    infoPrompts = [];
  });

  afterEach(() => {
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  function stubInfoPrompt(response: string | undefined) {
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoPrompts.push(message);
      return response;
    };
  }

  it('reported bug: clean tree + AUTO_STASH_IGNORE + existing branch stash → prompts, and "Pop" restores it', async () => {
    stubInfoPrompt('Pop');
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(makeGitStub(popCalls), 'main', nextBranch, AUTO_STASH_IGNORE);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(infoPrompts.length, 1);
    assert.match(infoPrompts[0], /Branch 'feature-x' has auto-stashed changes/);
    assert.deepStrictEqual(popCalls, [{ name: EXPECTED_STASH_MESSAGE, apply: false }]);
  });

  it('no branch stash present → no prompt and no restore', async () => {
    stubInfoPrompt('Pop');
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(
      makeGitStub(popCalls, { isStashWithMessageExists: async () => false }),
      'main',
      nextBranch,
      AUTO_STASH_IGNORE
    );

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(infoPrompts.length, 0);
    assert.strictEqual(popCalls.length, 0);
  });

  it('AUTO_STASH_CURRENT_BRANCH restores silently (no prompt) — preserves the existing auto-pop contract', async () => {
    stubInfoPrompt('Pop');
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(makeGitStub(popCalls), 'main', nextBranch, AUTO_STASH_CURRENT_BRANCH);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(infoPrompts.length, 0, 'auto mode must not prompt');
    assert.deepStrictEqual(popCalls, [{ name: EXPECTED_STASH_MESSAGE, apply: false }]);
  });

  it('prompt "Apply (keep stash)" restores via apply (keeps the stash)', async () => {
    stubInfoPrompt('Apply (keep stash)');
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(makeGitStub(popCalls), 'main', nextBranch, AUTO_STASH_IGNORE);

    assert.strictEqual(outcome, 'completed');
    assert.deepStrictEqual(popCalls, [{ name: EXPECTED_STASH_MESSAGE, apply: true }]);
  });

  it('dismissed prompt leaves the stash untouched', async () => {
    stubInfoPrompt(undefined);
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const outcome = await service.checkoutAndStashChanges(makeGitStub(popCalls), 'main', nextBranch, AUTO_STASH_IGNORE);

    assert.strictEqual(outcome, 'completed');
    assert.strictEqual(infoPrompts.length, 1);
    assert.strictEqual(popCalls.length, 0);
  });

  it('conflict while restoring → rescue notification, outcome "rescued"', async () => {
    stubInfoPrompt('Pop');
    const warnings: string[] = [];
    (vscode.window as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };
    const popCalls: PopCall[] = [];
    const service = new AutoStashService(makeConfigManagerStub(), mockLogService);

    const git = makeGitStub(popCalls, {
      popStash: async () => {
        throw new Error('conflict during pop');
      },
      getConflictedFiles: async () => ['a.txt'],
    });

    const outcome = await service.checkoutAndStashChanges(git, 'main', nextBranch, AUTO_STASH_IGNORE);

    assert.strictEqual(outcome, 'rescued');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Stash restored with conflicts: 1 file\(s\) need resolution/);
  });
});
