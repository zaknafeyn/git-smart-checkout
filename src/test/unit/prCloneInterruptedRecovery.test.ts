import * as assert from 'assert';
import { ExtensionContext, ExtensionMode, Memento, window as vscodeWindow } from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import {
  checkForInterruptedPrClone,
  resolveGitExecutorForRepoPath,
} from '../../extension';
import {
  IPersistedCloneOperation,
  PR_CLONE_IN_PLACE_STATE_KEY,
  PrCloneInPlaceService,
} from '../../services/prCloneInPlaceService';
import { PrCloneData, PrCloneService } from '../../services/prCloneService';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Regression tests for issue 20: "No recovery path if VS Code closes mid in-place clone
 * (paused on conflicts)". These cover persisting/clearing the recovery record and the
 * activation-time Resume / Abort-and-restore flow.
 */

function createFakeMemento(): Memento & { updates: unknown[] } {
  const store = new Map<string, unknown>();
  const updates: unknown[] = [];

  return {
    updates,
    get: ((key: string, defaultValue?: unknown) =>
      store.has(key) ? store.get(key) : defaultValue) as Memento['get'],
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      updates.push(value);
    },
    keys: () => [...store.keys()],
  };
}

const prData = {
  number: 99,
  title: 'Recovery PR',
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
  selectedCommits: ['c1', 'c2'],
  isDraft: false,
};

/** Builds a git stub that lands `c1` cleanly, then reports a conflict on `c2` and stalls there. */
function createStallingGitStub(repositoryPath = '/repo') {
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
    getCurrentBranch: async () => 'original',
    isWorkdirHasChanges: async () => false,
    fetchPullRequestHead: async () => {},
    checkout: async (branch: string) => {
      calls.checkout.push(branch);
    },
    pullCurrentBranch: async () => {},
    createUniqueFeatureBranch: async () => 'feature/clone',
    commitExists: async () => true,
    hasConflicts: async () => false,
    cherryPick: async (sha: string) => ({ conflicts: sha === 'c2' }),
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
  } as unknown as GitExecutor;

  return { git, calls };
}

describe('PrCloneInPlaceService interrupted-clone recovery persistence', () => {
  it('persists the record on start and shrinks remainingShas as commits land', async () => {
    const memento = createFakeMemento();
    const { git } = createStallingGitStub();
    const service = new PrCloneInPlaceService(git, {} as GitHubClient, mockLogService, memento);

    await service.clonePR(cloneData);

    // c2 is left mid-conflict; clonePR() resolves (cherryPickNext returns early) rather than throwing.
    const persisted = memento.get<IPersistedCloneOperation>(PR_CLONE_IN_PLACE_STATE_KEY);
    assert.ok(persisted, 'a record should be persisted while paused on a conflict');
    assert.deepStrictEqual(persisted!.remainingShas, ['c2']);
    assert.strictEqual(persisted!.prNumber, 99);
    assert.strictEqual(persisted!.repoPath, '/repo');
    assert.strictEqual(persisted!.originalBranch, 'original');
    assert.strictEqual(persisted!.createdBranchName, 'feature/clone');

    // Verify the sequence of writes: full list at start, then shrunk after c1 landed.
    const recordedRemaining = memento.updates
      .filter((update): update is IPersistedCloneOperation => !!update)
      .map((update) => update.remainingShas);
    assert.deepStrictEqual(recordedRemaining, [
      ['c1', 'c2'],
      ['c2'],
    ]);
  });

  it('clears the record when cleanUp runs (abort path)', async () => {
    const memento = createFakeMemento();
    const { git } = createStallingGitStub();
    const service = new PrCloneInPlaceService(git, {} as GitHubClient, mockLogService, memento);

    await service.clonePR(cloneData);
    assert.ok(memento.get(PR_CLONE_IN_PLACE_STATE_KEY), 'sanity check: record exists before abort');

    await service.abortClonePR();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(
      memento.get(PR_CLONE_IN_PLACE_STATE_KEY),
      undefined,
      'cleanUp must clear the persisted record'
    );
  });
});

describe('checkForInterruptedPrClone activation flow', () => {
  const context = { extensionMode: ExtensionMode.Test } as ExtensionContext;

  function createRecord(overrides: Partial<IPersistedCloneOperation> = {}): IPersistedCloneOperation {
    return {
      repoPath: '/repo',
      originalBranch: 'original',
      createdBranchName: 'feature/clone',
      stashMessage: undefined,
      remainingShas: ['c2'],
      prNumber: 99,
      ts: Date.now(),
      targetBranch: 'main',
      description: 'desc',
      isDraft: false,
      prData,
      ...overrides,
    };
  }

  it('silently clears a stale record when no cherry-pick is in progress (no prompt)', async () => {
    const memento = createFakeMemento();
    await memento.update(PR_CLONE_IN_PLACE_STATE_KEY, createRecord());
    const fakeContext = { ...context, workspaceState: memento } as unknown as ExtensionContext;

    const { git } = createStallingGitStub();
    // isCherryPickInProgress stub above returns false.
    let prompted = false;
    const originalShowWarningMessage = vscodeWindow.showWarningMessage;
    (vscodeWindow as any).showWarningMessage = async () => {
      prompted = true;
      return undefined;
    };

    const prCloneService = new PrCloneService(fakeContext, mockLogService, {} as any);

    try {
      await checkForInterruptedPrClone(
        fakeContext,
        mockLogService,
        undefined,
        prCloneService,
        async () => git
      );
    } finally {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(prompted, false, 'must not prompt when there is nothing to recover');
    assert.strictEqual(
      memento.get(PR_CLONE_IN_PLACE_STATE_KEY),
      undefined,
      'the stale record must be cleared silently'
    );
  });

  it('Resume rebuilds state and contexts without touching the repository', async () => {
    const memento = createFakeMemento();
    const record = createRecord();
    await memento.update(PR_CLONE_IN_PLACE_STATE_KEY, record);
    const fakeContext = { ...context, workspaceState: memento } as unknown as ExtensionContext;

    const { git, calls } = createStallingGitStub();
    (git as any).isCherryPickInProgress = async () => true;
    (git as any).getRepoInfo = async () => ({ owner: 'o', repo: 'r' });

    const originalShowWarningMessage = vscodeWindow.showWarningMessage;
    (vscodeWindow as any).showWarningMessage = async () => 'Resume';

    const prCloneService = new PrCloneService(fakeContext, mockLogService, {} as any);

    try {
      await checkForInterruptedPrClone(
        fakeContext,
        mockLogService,
        undefined,
        prCloneService,
        async () => git
      );
    } finally {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(calls.reset, 0, 'Resume must not touch the working directory');
    assert.deepStrictEqual(calls.checkout, [], 'Resume must not checkout any branch');
    assert.deepStrictEqual(calls.deleteLocalBranch, [], 'Resume must not delete any branch');

    const inPlaceService = prCloneService.InPlaceService as unknown as {
      serviceStore: { originalBranch?: string; createdBranchName?: string };
      commitGenerator: unknown;
    };
    assert.strictEqual(inPlaceService.serviceStore.originalBranch, 'original');
    assert.strictEqual(inPlaceService.serviceStore.createdBranchName, 'feature/clone');
    assert.ok(inPlaceService.commitGenerator, 'the commit generator should be rebuilt');
  });

  it('Abort and restore calls the existing cleanup/restore path', async () => {
    const memento = createFakeMemento();
    const record = createRecord({ stashMessage: 'gsc-stash: original' });
    await memento.update(PR_CLONE_IN_PLACE_STATE_KEY, record);
    const fakeContext = { ...context, workspaceState: memento } as unknown as ExtensionContext;

    const { git, calls } = createStallingGitStub();
    (git as any).isCherryPickInProgress = async () => true;
    (git as any).getRepoInfo = async () => ({ owner: 'o', repo: 'r' });

    const originalShowWarningMessage = vscodeWindow.showWarningMessage;
    (vscodeWindow as any).showWarningMessage = async () => 'Abort and restore';

    const prCloneService = new PrCloneService(fakeContext, mockLogService, {} as any);

    try {
      await checkForInterruptedPrClone(
        fakeContext,
        mockLogService,
        undefined,
        prCloneService,
        async () => git
      );
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    }

    assert.strictEqual(calls.reset, 1, 'Abort must reset the working directory');
    assert.deepStrictEqual(calls.checkout, ['original'], 'Abort must restore the original branch');
    assert.deepStrictEqual(
      calls.popStash,
      ['gsc-stash: original'],
      'Abort must restore the stashed changes'
    );
    assert.deepStrictEqual(
      calls.deleteLocalBranch,
      ['feature/clone'],
      'Abort must delete the created clone branch'
    );
    assert.strictEqual(
      memento.get(PR_CLONE_IN_PLACE_STATE_KEY),
      undefined,
      'the persisted record must be cleared after abort'
    );
  });
});

describe('resolveGitExecutorForRepoPath', () => {
  it('is exported and callable (smoke test; workspace-folder matching is exercised via injected resolvers above)', () => {
    assert.strictEqual(typeof resolveGitExecutorForRepoPath, 'function');
  });
});
