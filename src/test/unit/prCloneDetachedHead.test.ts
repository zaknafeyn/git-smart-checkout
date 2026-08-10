import * as assert from 'assert';
import { Memento } from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import {
  IPersistedCloneOperation,
  PR_CLONE_IN_PLACE_STATE_KEY,
  PrCloneInPlaceService,
} from '../../services/prCloneInPlaceService';
import { PrCloneData } from '../../services/prCloneService';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Regression tests for issue 204: "Detached HEAD silently disables PR-clone rollback".
 *
 * When a PR clone is started from a detached HEAD, `getCurrentBranch()` returns `''`, which
 * used to make cleanUp() short-circuit (nothing restored, created branch/stash left behind)
 * and persistState() refuse to write a crash-recovery record. The fix captures the detached
 * commit SHA via `getHeadCommit()` and restores/persists against that instead.
 */

function createFakeMemento(): Memento {
  const store = new Map<string, unknown>();

  return {
    get: ((key: string, defaultValue?: unknown) =>
      store.has(key) ? store.get(key) : defaultValue) as Memento['get'],
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
    keys: () => [...store.keys()],
  };
}

const prData = {
  number: 204,
  title: 'Detached HEAD PR',
  body: 'desc',
  head: { ref: 'feature/source' },
  base: { ref: 'main' },
  labels: [],
  assignees: [],
} as unknown as GitHubPR;

const cloneData: PrCloneData = {
  prData,
  targetBranch: 'main',
  featureBranch: 'feature/clone',
  description: 'desc',
  selectedCommits: ['c1'],
  isDraft: false,
};

const DETACHED_SHA = 'abc1234deadbeefabc1234deadbeefabc1234de';

function createDetachedGitStub(repositoryPath = '/repo') {
  const calls = {
    reset: 0,
    checkout: [] as string[],
    popStash: [] as string[],
    deleteLocalBranch: [] as string[],
    cherryPickAbort: 0,
    isCherryPickInProgress: 0,
  };

  const git = {
    repositoryPath,
    getCurrentBranch: async () => '',
    getHeadCommit: async () => DETACHED_SHA,
    isWorkdirHasChanges: async () => false,
    fetchPullRequestHead: async () => {},
    checkout: async (branch: string) => {
      calls.checkout.push(branch);
    },
    pullCurrentBranch: async () => {},
    createUniqueFeatureBranch: async () => 'feature/clone',
    commitExists: async () => true,
    hasConflicts: async () => false,
    cherryPick: async () => ({ conflicts: false }),
    isCherryPickInProgress: async () => {
      calls.isCherryPickInProgress += 1;
      return false;
    },
    reset: async () => {
      calls.reset += 1;
    },
    popStash: async (message: string) => {
      calls.popStash.push(message);
    },
    deleteLocalBranch: async (branch: string) => {
      calls.deleteLocalBranch.push(branch);
    },
    cherryPickAbort: async () => {
      calls.cherryPickAbort += 1;
    },
    pushBranchToGitHub: async () => {},
  } as unknown as GitExecutor;

  return { git, calls };
}

describe('PrCloneInPlaceService detached-HEAD rollback (issue 204)', () => {
  it('captures the HEAD SHA and persists state when started from detached HEAD', async () => {
    const memento = createFakeMemento();
    const { git } = createDetachedGitStub();
    // Stall on a conflict so we can inspect the persisted record before cleanup runs.
    (git as any).cherryPick = async () => ({ conflicts: true });
    const service = new PrCloneInPlaceService(git, {} as GitHubClient, mockLogService, memento);

    await service.clonePR(cloneData);

    const persisted = memento.get<IPersistedCloneOperation>(PR_CLONE_IN_PLACE_STATE_KEY);
    assert.ok(persisted, 'a record should be persisted even though originalBranch is empty');
    assert.strictEqual(persisted!.originalBranch, '', 'originalBranch stays empty for compatibility');
    assert.strictEqual(persisted!.originalRef, DETACHED_SHA, 'originalRef must capture the detached SHA');
    assert.strictEqual(persisted!.isDetached, true);
  });

  it('cleanUp checks out the captured SHA (not a branch name) instead of silently returning', async () => {
    const memento = createFakeMemento();
    const { git, calls } = createDetachedGitStub();
    (git as any).cherryPick = async () => ({ conflicts: true });
    const service = new PrCloneInPlaceService(git, {} as GitHubClient, mockLogService, memento);

    await service.clonePR(cloneData);
    // clonePR itself checks out the target branch and the new feature branch; only the
    // checkout(s) issued by cleanUp (below) are relevant to this assertion.
    calls.checkout.length = 0;

    await service.abortClonePR();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(calls.reset, 1, 'a started clone must still hard-reset on abort');
    assert.deepStrictEqual(
      calls.checkout,
      [DETACHED_SHA],
      'cleanup must restore by checking out the captured SHA, not a (nonexistent) branch name'
    );
    assert.deepStrictEqual(
      calls.deleteLocalBranch,
      ['feature/clone'],
      'the created feature branch must still be deleted on abort'
    );
    assert.strictEqual(
      memento.get(PR_CLONE_IN_PLACE_STATE_KEY),
      undefined,
      'the persisted record must be cleared after abort'
    );
  });

  it('cleanUp no longer short-circuits when originalBranch is empty but originalRef is set', async () => {
    const { git, calls } = createDetachedGitStub();
    const service = new PrCloneInPlaceService(git, {} as GitHubClient, mockLogService);

    (service as any).serviceStore = {
      originalBranch: '',
      originalRef: DETACHED_SHA,
      isDetached: true,
      createdBranchName: 'feature/clone',
    };

    await (service as any).cleanUp(true);

    assert.deepStrictEqual(calls.checkout, [DETACHED_SHA]);
    assert.deepStrictEqual(calls.deleteLocalBranch, ['feature/clone']);
  });
});
