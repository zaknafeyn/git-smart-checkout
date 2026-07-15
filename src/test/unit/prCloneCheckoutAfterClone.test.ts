import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { window as vscodeWindow } from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { EXTENSION_NAME } from '../../const';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Coverage for Feature 9 (issue #29): `git-smart-checkout.prClone.checkoutAfterClone`
 * ("ask" | "always" | "never"). Exercises the setting matrix across both PR Clone
 * strategies (in-place cherry-pick and temp-worktree).
 */

type CheckoutAfterClone = 'ask' | 'always' | 'never';

function makeConfigManager(
  checkoutAfterClone: CheckoutAfterClone,
  defaultWorktreeDirectory = ''
): ConfigurationManager {
  return {
    get: () => ({
      prClone: { checkoutAfterClone },
      defaultWorktreeDirectory,
    }),
  } as unknown as ConfigurationManager;
}

function stubShowInformationMessage(script: (string | undefined)[] | string | undefined) {
  const calls: unknown[][] = [];
  const responses = Array.isArray(script) ? [...script] : undefined;
  const singleResponse = Array.isArray(script) ? undefined : script;
  const original = vscodeWindow.showInformationMessage;

  (vscodeWindow as any).showInformationMessage = async (...args: unknown[]) => {
    calls.push(args);
    if (responses) {
      return responses.length > 0 ? responses.shift() : undefined;
    }
    return singleResponse;
  };

  return {
    calls,
    restore: () => {
      (vscodeWindow as any).showInformationMessage = original;
    },
  };
}

describe('PrCloneInPlaceService: prClone.checkoutAfterClone', () => {
  function createGitStub() {
    const calls = {
      checkout: [] as string[],
      popStash: [] as string[],
      reset: [] as boolean[],
      deleteLocalBranch: [] as string[],
    };

    const gitStub = {
      reset: async (hard = false) => {
        calls.reset.push(hard);
      },
      checkout: async (branch: string) => {
        calls.checkout.push(branch);
      },
      isCherryPickInProgress: async () => false,
      cherryPickAbort: async () => {},
      popStash: async (message: string) => {
        calls.popStash.push(message);
      },
      deleteLocalBranch: async (branch: string) => {
        calls.deleteLocalBranch.push(branch);
      },
    } as unknown as GitExecutor;

    return { gitStub, calls };
  }

  function createService(gitStub: GitExecutor, checkoutAfterClone?: CheckoutAfterClone) {
    return new PrCloneInPlaceService(
      gitStub,
      {} as GitHubClient,
      mockLogService,
      undefined,
      checkoutAfterClone ? makeConfigManager(checkoutAfterClone) : undefined
    );
  }

  it('never: restores original branch and pops the stash on success (baseline)', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'never');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
      stashMessage: 'gsc-stash-main',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, ['main']);
    assert.deepStrictEqual(calls.popStash, ['gsc-stash-main']);
    assert.deepStrictEqual(info.calls, [], 'never must not prompt the user');
  });

  it('always: skips the restore-to-original-branch step and never pops the stash', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'always');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
      stashMessage: 'gsc-stash-main',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, [], 'must not restore the original branch');
    assert.deepStrictEqual(calls.popStash, [], 'the user WIP stash must remain untouched');

    const toastMessages = info.calls.map((args) => String(args[0]));
    assert.ok(
      toastMessages.some((message) => message.toLowerCase().includes('stash')),
      `expected a toast mentioning the stash, got: ${JSON.stringify(toastMessages)}`
    );
  });

  it('always: does not prompt when there is no WIP stash to preserve', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'always');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, []);
    assert.deepStrictEqual(info.calls, []);
  });

  it('ask: choosing "Switch to it" behaves like "always" (stays on the cloned branch)', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'ask');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
      stashMessage: 'gsc-stash-main',
    };

    const info = stubShowInformationMessage('Switch to it');
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, []);
    assert.deepStrictEqual(calls.popStash, []);
    // One call for the ask prompt itself, plus one for the "your changes remain stashed" toast
    // (since a stash is present in this scenario).
    assert.strictEqual(info.calls.length, 2, 'expected the ask prompt plus the stash-preserved toast');
    assert.strictEqual(info.calls[0][0], "PR cloned to branch 'feature_clone'. Switch to it, or stay on 'main'?");
  });

  it('ask: dismissing the prompt restores the original branch, exactly like "never"', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'ask');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
      stashMessage: 'gsc-stash-main',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, ['main']);
    assert.deepStrictEqual(calls.popStash, ['gsc-stash-main']);
  });

  it('missing configurationManager defaults to "ask" semantics', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub /* no checkoutAfterClone */);
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(false);
    } finally {
      info.restore();
    }

    assert.strictEqual(info.calls.length, 1, 'should have prompted (ask default)');
    assert.deepStrictEqual(calls.checkout, ['main'], 'dismiss defaults to restoring, like "never"');
  });

  it('failure path: abort restores original state regardless of "always" (setting has no effect)', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'always');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
      stashMessage: 'gsc-stash-main',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(true);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, ['main'], 'abort must always restore the original branch');
    assert.deepStrictEqual(calls.popStash, ['gsc-stash-main'], 'abort must always restore the stash');
    assert.deepStrictEqual(calls.deleteLocalBranch, ['feature_clone'], 'abort still deletes the clone branch');
  });

  it('failure path: abort never prompts the user, even in "ask" mode', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub, 'ask');
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature_clone',
    };

    const info = stubShowInformationMessage(undefined);
    try {
      await (service as any).cleanUp(true);
    } finally {
      info.restore();
    }

    assert.deepStrictEqual(calls.checkout, ['main']);
    assert.deepStrictEqual(info.calls, [], 'abort must not show the checkoutAfterClone prompt');
  });
});

describe('PrCloneTempWorktreeService: prClone.checkoutAfterClone', () => {
  function createGitStub(worktreeMove?: (from: string, to: string) => Promise<void>) {
    return {
      repositoryPath: '/repo',
      worktreeMove:
        worktreeMove ??
        (async () => {
          /* no-op by default */
        }),
    } as unknown as GitExecutor;
  }

  function createService(checkoutAfterClone: CheckoutAfterClone, baseDirectory = '', gitStub?: GitExecutor) {
    return new PrCloneTempWorktreeService(
      gitStub ?? createGitStub(),
      {} as GitHubClient,
      mockLogService,
      makeConfigManager(checkoutAfterClone, baseDirectory)
    );
  }

  it('never: keeps nothing and never prompts (regression guard — worktree is torn down by caller)', async () => {
    const service = createService('never');
    const info = stubShowInformationMessage(undefined);

    let result: string | undefined;
    try {
      result = await (service as any).resolveWorktreeKeepDecision(
        '/tmp/does-not-matter',
        'feature_clone',
        42
      );
    } finally {
      info.restore();
    }

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(info.calls, []);
  });

  it('always: keeps and moves the worktree into the configured base directory', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-checkout-base-'));
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-test-`));
    const moveCalls: Array<[string, string]> = [];

    const gitStub = createGitStub(async (from, to) => {
      moveCalls.push([from, to]);
    });
    const service = createService('always', baseDir, gitStub);
    const info = stubShowInformationMessage(undefined);

    try {
      const result = await (service as any).resolveWorktreeKeepDecision(tempPath, 'feature_clone', 42);

      assert.strictEqual(moveCalls.length, 1, 'worktreeMove must be invoked exactly once');
      assert.strictEqual(moveCalls[0][0], tempPath);
      assert.strictEqual(path.dirname(moveCalls[0][1]), baseDir);
      assert.strictEqual(result, moveCalls[0][1]);
      // "always" skips the ask prompt entirely; the only showInformationMessage call is the
      // (unrelated) worktree-completion-actions prompt fired after the move succeeds.
      const messages = info.calls.map((args) => String(args[0]));
      assert.ok(
        !messages.some((message) => message.includes('Open worktree')),
        'always must not show the ask prompt'
      );
    } finally {
      info.restore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });

  it('worktreeMove failure (EXDEV-style) falls back to keeping the worktree at its temp path, without throwing', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-checkout-base-'));
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-test-`));

    const gitStub = createGitStub(async () => {
      const error: NodeJS.ErrnoException = new Error('cross-device link not permitted');
      error.code = 'EXDEV';
      throw error;
    });
    const service = createService('always', baseDir, gitStub);

    try {
      const result = await (service as any).moveWorktreeToBaseDirectory(tempPath);
      assert.strictEqual(result, tempPath, 'must fall back to the original temp path without throwing');
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });

  it('ask: choosing "Open worktree" keeps and moves the worktree', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-checkout-base-'));
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-test-`));
    const moveCalls: Array<[string, string]> = [];

    const gitStub = createGitStub(async (from, to) => {
      moveCalls.push([from, to]);
    });
    const service = createService('ask', baseDir, gitStub);
    // First prompt (ask) -> "Open worktree"; any subsequent prompt (completion actions) -> dismissed.
    const info = stubShowInformationMessage(['Open worktree', undefined]);

    try {
      const result = await (service as any).resolveWorktreeKeepDecision(tempPath, 'feature_clone', 42);
      assert.strictEqual(moveCalls.length, 1);
      assert.strictEqual(result, moveCalls[0][1]);
    } finally {
      info.restore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });

  it('ask: dismissing the prompt tears down (no move, no keep) — same as "never"', async () => {
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), `${EXTENSION_NAME}-pr-clone-test-`));
    const moveCalls: Array<[string, string]> = [];

    const gitStub = createGitStub(async (from, to) => {
      moveCalls.push([from, to]);
    });
    const service = createService('ask', '', gitStub);
    const info = stubShowInformationMessage(undefined);

    try {
      const result = await (service as any).resolveWorktreeKeepDecision(tempPath, 'feature_clone', 42);
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(moveCalls, []);
    } finally {
      info.restore();
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });

  it('missing configurationManager defaults to "ask" semantics', async () => {
    const service = new PrCloneTempWorktreeService(createGitStub(), {} as GitHubClient, mockLogService);
    const info = stubShowInformationMessage(undefined);

    try {
      const result = await (service as any).resolveWorktreeKeepDecision(
        '/tmp/does-not-matter',
        'feature_clone',
        42
      );
      assert.strictEqual(result, undefined, 'dismiss defaults to tearing down, like "never"');
      assert.strictEqual(info.calls.length, 1, 'should have prompted (ask default)');
    } finally {
      info.restore();
    }
  });
});
