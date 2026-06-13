import * as assert from 'assert';

import { GitExecutor } from '../../common/git/gitExecutor';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Regression tests for the critical data-loss bug where cancelling a PR clone
 * in temp-worktree mode hard-reset the user's main repository.
 *
 * The in-place service must never touch (hard reset / checkout) the working
 * directory when it was never started (empty serviceStore) — which is exactly
 * the state it is left in while temp-worktree mode is active.
 */
describe('PrCloneInPlaceService.cleanUp (abort) guard', () => {
  interface GitCalls {
    reset: Array<boolean>;
    checkout: Array<string>;
    isCherryPickInProgress: number;
    cherryPickAbort: number;
    deleteLocalBranch: Array<string>;
  }

  const createGitStub = (cherryPickInProgress = false) => {
    const calls: GitCalls = {
      reset: [],
      checkout: [],
      isCherryPickInProgress: 0,
      cherryPickAbort: 0,
      deleteLocalBranch: [],
    };

    const gitStub = {
      reset: async (hard = false) => {
        calls.reset.push(hard);
      },
      checkout: async (branch: string) => {
        calls.checkout.push(branch);
      },
      isCherryPickInProgress: async () => {
        calls.isCherryPickInProgress += 1;
        return cherryPickInProgress;
      },
      cherryPickAbort: async () => {
        calls.cherryPickAbort += 1;
      },
      popStash: async () => {},
      deleteLocalBranch: async (branch: string) => {
        calls.deleteLocalBranch.push(branch);
      },
    } as unknown as GitExecutor;

    return { gitStub, calls };
  };

  const createService = (gitStub: GitExecutor) =>
    new PrCloneInPlaceService(gitStub, {} as any, mockLogService);

  it('does NOT hard-reset or checkout when the service was never started (temp-worktree mode)', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub);

    // Simulate the temp-worktree path: the in-place service holds an empty
    // store because it was never used to start a clone.
    await service.abortClonePR();
    // allow the async cleanUp triggered by abortClonePR to settle
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(
      calls.reset,
      [],
      'reset() must never be called when the service was not started'
    );
    assert.deepStrictEqual(
      calls.checkout,
      [],
      'checkout() must never be called when the service was not started'
    );
    assert.strictEqual(
      calls.isCherryPickInProgress,
      0,
      'cherry-pick state must not be inspected before the originalBranch guard'
    );
  });

  it('hard-resets and restores the original branch when a clone was actually started', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub);

    // Reproduce the state of a started in-place clone.
    (service as any).serviceStore = {
      originalBranch: 'main',
      createdBranchName: 'feature/foo',
      isAborting: false,
    };

    await (service as any).cleanUp(true);

    assert.deepStrictEqual(
      calls.reset,
      [true],
      'a started clone must perform exactly one hard reset'
    );
    assert.deepStrictEqual(
      calls.checkout,
      ['main'],
      'a started clone must restore the original branch'
    );
    assert.deepStrictEqual(
      calls.deleteLocalBranch,
      ['feature/foo'],
      'aborting a started clone must delete the created branch'
    );
  });

  it('does NOT hard-reset when started but no feature branch was created yet', async () => {
    const { gitStub, calls } = createGitStub();
    const service = createService(gitStub);

    // originalBranch is set (clone began) but createdBranchName is still absent.
    (service as any).serviceStore = {
      originalBranch: 'main',
    };

    await (service as any).cleanUp(true);

    assert.deepStrictEqual(
      calls.reset,
      [],
      'no hard reset should occur before a feature branch is created'
    );
    assert.deepStrictEqual(
      calls.checkout,
      ['main'],
      'the original branch should still be restored'
    );
  });
});
