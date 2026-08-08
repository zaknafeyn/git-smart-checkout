import * as assert from 'assert';

import { mergeStackEntries, StackEntry, StackStore } from '../../services/stackStore';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('mergeStackEntries', () => {
  it('keeps manual entries and drops any detected entry for the same branch', () => {
    const existing: StackEntry[] = [
      { branch: 'feat/ui', parent: 'feat/manual-parent', source: 'manual' },
    ];
    const detected: StackEntry[] = [
      { branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' },
      { branch: 'feat/docs', parent: 'feat/ui', source: 'github' },
    ];

    const merged = mergeStackEntries(existing, detected);

    assert.strictEqual(merged.length, 2);
    const uiEntry = merged.find((e) => e.branch === 'feat/ui');
    assert.strictEqual(uiEntry?.parent, 'feat/manual-parent');
    assert.strictEqual(uiEntry?.source, 'manual');
    const docsEntry = merged.find((e) => e.branch === 'feat/docs');
    assert.strictEqual(docsEntry?.source, 'github');
  });

  it('replaces stale detected entries with freshly-detected ones', () => {
    const existing: StackEntry[] = [{ branch: 'feat/ui', parent: 'feat/old', source: 'heuristic' }];
    const detected: StackEntry[] = [{ branch: 'feat/ui', parent: 'feat/new', source: 'heuristic' }];

    const merged = mergeStackEntries(existing, detected);

    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].parent, 'feat/new');
  });
});

function makeMemento() {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T,
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

describe('StackStore', () => {
  it('returns an empty array when nothing is stored', async () => {
    const store = new StackStore(makeMemento(), mockLogService);
    assert.deepStrictEqual(await store.getAll(), []);
  });

  it('persists detected entries and merges manual overrides in on subsequent detections', async () => {
    const store = new StackStore(makeMemento(), mockLogService);

    await store.applyDetection([{ branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' }]);
    await store.setManualParent('feat/ui', 'feat/other');

    await store.applyDetection([{ branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' }]);

    const entry = await store.getForBranch('feat/ui');
    assert.strictEqual(entry?.parent, 'feat/other');
    assert.strictEqual(entry?.source, 'manual');
  });

  it('remove() deletes a branch entry', async () => {
    const store = new StackStore(makeMemento(), mockLogService);
    await store.applyDetection([{ branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' }]);
    await store.remove('feat/ui');
    assert.strictEqual(await store.getForBranch('feat/ui'), undefined);
  });

  it('returns empty results and never throws when constructed without storage', async () => {
    const store = new StackStore(undefined, mockLogService);
    await store.applyDetection([{ branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' }]);
    assert.deepStrictEqual(await store.getAll(), []);
  });
});
