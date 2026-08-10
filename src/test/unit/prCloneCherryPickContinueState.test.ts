import * as assert from 'assert';
import { window as vscodeWindow } from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Regression tests for issue #207: "Cherry-pick continue-vs-skip decided by workdir
 * dirtiness — silently drops commits". `cherryPickNext(true)` must decide continue vs.
 * skip vs. prompt from real cherry-pick state (`getUnresolvedConflicts()` +
 * `isWorkdirHasChanges()`), never silently skip a legitimately-empty resolution.
 */
describe('PrCloneInPlaceService.cherryPickNext(true) conflict-state decision', () => {
  interface GitCalls {
    getUnresolvedConflicts: number;
    isWorkdirHasChanges: number;
    cherryPickContinue: number;
    cherryPickSkip: number;
    commitAllowEmpty: number;
  }

  const createGitStub = (opts: { unresolvedConflicts?: string[]; workdirHasChanges?: boolean }) => {
    const calls: GitCalls = {
      getUnresolvedConflicts: 0,
      isWorkdirHasChanges: 0,
      cherryPickContinue: 0,
      cherryPickSkip: 0,
      commitAllowEmpty: 0,
    };

    const gitStub = {
      hasConflicts: async () => false,
      getUnresolvedConflicts: async () => {
        calls.getUnresolvedConflicts += 1;
        return opts.unresolvedConflicts ?? [];
      },
      isWorkdirHasChanges: async () => {
        calls.isWorkdirHasChanges += 1;
        return opts.workdirHasChanges ?? false;
      },
      cherryPickContinue: async () => {
        calls.cherryPickContinue += 1;
      },
      cherryPickSkip: async () => {
        calls.cherryPickSkip += 1;
      },
      commitAllowEmpty: async () => {
        calls.commitAllowEmpty += 1;
      },
      // Reached only after the decision under test; make it fail predictably so the
      // remainder of cherryPickNext's "commit landed" flow short-circuits via the
      // existing try/catch, without needing to mock the full push/PR-creation chain.
      pushBranchToGitHub: async () => {
        throw new Error('stop-after-decision (expected in this test)');
      },
    } as unknown as GitExecutor;

    return { gitStub, calls };
  };

  // A fake commit generator that is immediately "done" — cherryPickNext's post-decision
  // code path (push/PR creation) is not what these tests exercise; see pushBranchToGitHub
  // stub above for how that path is short-circuited.
  const fakeDoneGenerator = () =>
    (async function* () {
      // no commits to yield
    })();

  const createService = (gitStub: GitExecutor) => {
    const service = new PrCloneInPlaceService(gitStub, {} as any, mockLogService);
    (service as any).commitGenerator = fakeDoneGenerator();
    return service;
  };

  let originalShowWarningMessage: typeof vscodeWindow.showWarningMessage;
  let originalShowQuickPick: typeof vscodeWindow.showQuickPick;
  let originalShowErrorMessage: typeof vscodeWindow.showErrorMessage;

  const stubWindow = () => {
    const warnings: string[] = [];
    let quickPickResponse: string | undefined;

    originalShowWarningMessage = vscodeWindow.showWarningMessage;
    originalShowQuickPick = vscodeWindow.showQuickPick;
    originalShowErrorMessage = vscodeWindow.showErrorMessage;

    (vscodeWindow as any).showWarningMessage = async (message: string) => {
      warnings.push(message);
      return undefined;
    };
    let quickPickCallCount = 0;
    (vscodeWindow as any).showQuickPick = async () => {
      quickPickCallCount += 1;
      return quickPickResponse;
    };
    (vscodeWindow as any).showErrorMessage = async () => undefined;

    return {
      warnings,
      setQuickPickResponse: (value: string | undefined) => {
        quickPickResponse = value;
      },
      getQuickPickCallCount: () => quickPickCallCount,
    };
  };

  const restoreWindow = () => {
    (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    (vscodeWindow as any).showQuickPick = originalShowQuickPick;
    (vscodeWindow as any).showErrorMessage = originalShowErrorMessage;
  };

  it('unresolved conflicts remain: warns with the file list, never continues or skips', async () => {
    const { gitStub, calls } = createGitStub({ unresolvedConflicts: ['src/foo.ts', 'src/bar.ts'] });
    const service = createService(gitStub);
    const { warnings } = stubWindow();

    try {
      await service.cherryPickNext(true);
    } finally {
      restoreWindow();
    }

    assert.strictEqual(calls.getUnresolvedConflicts, 1);
    assert.strictEqual(calls.cherryPickContinue, 0, 'must not continue with unresolved conflicts');
    assert.strictEqual(calls.cherryPickSkip, 0, 'must not skip with unresolved conflicts');
    assert.strictEqual(calls.commitAllowEmpty, 0);
    assert.strictEqual(calls.isWorkdirHasChanges, 0, 'must not even consult workdir dirtiness');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /src\/foo\.ts/);
    assert.match(warnings[0], /src\/bar\.ts/);
  });

  it('resolved, non-empty result: continues the cherry-pick, no prompt shown', async () => {
    const { gitStub, calls } = createGitStub({ unresolvedConflicts: [], workdirHasChanges: true });
    const service = createService(gitStub);
    const { getQuickPickCallCount } = stubWindow();

    try {
      await service.cherryPickNext(true);
    } catch {
      // expected: the post-decision push/PR flow short-circuits via the stubbed
      // pushBranchToGitHub rejection — irrelevant to this test.
    } finally {
      restoreWindow();
    }

    assert.strictEqual(calls.cherryPickContinue, 1, 'must continue when the result is non-empty');
    assert.strictEqual(calls.cherryPickSkip, 0);
    assert.strictEqual(calls.commitAllowEmpty, 0);
    assert.strictEqual(getQuickPickCallCount(), 0, 'must not prompt when the result is non-empty');
  });

  describe('resolved, empty result (the issue #207 failure scenario)', () => {
    it('never silently skips — prompts, and "Keep as empty commit" commits an empty commit', async () => {
      const { gitStub, calls } = createGitStub({ unresolvedConflicts: [], workdirHasChanges: false });
      const service = createService(gitStub);
      const { setQuickPickResponse, getQuickPickCallCount } = stubWindow();
      setQuickPickResponse('Keep as empty commit');

      try {
        await service.cherryPickNext(true);
      } catch {
        // expected short-circuit past the decision under test; see stub comment above.
      } finally {
        restoreWindow();
      }

      assert.strictEqual(getQuickPickCallCount(), 1, 'must prompt instead of silently skipping');
      assert.strictEqual(calls.commitAllowEmpty, 1);
      assert.strictEqual(calls.cherryPickSkip, 0);
      assert.strictEqual(calls.cherryPickContinue, 0);
    });

    it('"Skip this commit" explicitly chosen skips the commit', async () => {
      const { gitStub, calls } = createGitStub({ unresolvedConflicts: [], workdirHasChanges: false });
      const service = createService(gitStub);
      const { setQuickPickResponse } = stubWindow();
      setQuickPickResponse('Skip this commit');

      try {
        await service.cherryPickNext(true);
      } catch {
        // expected short-circuit past the decision under test; see stub comment above.
      } finally {
        restoreWindow();
      }

      assert.strictEqual(calls.cherryPickSkip, 1);
      assert.strictEqual(calls.commitAllowEmpty, 0);
      assert.strictEqual(calls.cherryPickContinue, 0);
    });

    it('dismissing the prompt (Escape) aborts the clone rather than skipping or continuing', async () => {
      const { gitStub, calls } = createGitStub({ unresolvedConflicts: [], workdirHasChanges: false });
      const service = createService(gitStub);
      const { setQuickPickResponse } = stubWindow();
      setQuickPickResponse(undefined);

      try {
        await service.cherryPickNext(true);
      } finally {
        restoreWindow();
      }

      assert.strictEqual(calls.cherryPickSkip, 0);
      assert.strictEqual(calls.commitAllowEmpty, 0);
      assert.strictEqual(calls.cherryPickContinue, 0);
    });
  });
});
