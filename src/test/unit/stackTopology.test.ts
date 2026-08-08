import * as assert from 'assert';

import { buildStackForest, findStackContaining, topoOrder } from '../../services/stackTopology';
import { StackEntry } from '../../services/stackStore';

const chainEntries: StackEntry[] = [
  { branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' },
  { branch: 'feat/docs', parent: 'feat/ui', source: 'heuristic' },
];

describe('buildStackForest', () => {
  it('identifies the root (no recorded parent) and builds a children map', () => {
    const forest = buildStackForest(chainEntries, new Set(['feat/api', 'feat/ui', 'feat/docs']));

    assert.deepStrictEqual(forest.roots, ['feat/api']);
    assert.deepStrictEqual(forest.childrenOf.get('feat/api'), ['feat/ui']);
    assert.deepStrictEqual(forest.childrenOf.get('feat/ui'), ['feat/docs']);
  });

  it('drops entries whose parent branch no longer exists locally (orphaned children become roots)', () => {
    // feat/api was deleted; feat/ui's entry pointing at it must be dropped,
    // reparenting feat/ui to trunk implicitly (it becomes its own root).
    // feat/docs -> feat/ui is unaffected, since both are still live.
    const forest = buildStackForest(chainEntries, new Set(['feat/ui', 'feat/docs']));

    assert.ok(!forest.parentOf.has('feat/ui'));
    assert.deepStrictEqual(forest.roots, ['feat/ui']);
    assert.deepStrictEqual(forest.childrenOf.get('feat/ui'), ['feat/docs']);
  });

  it('supports multiple children under one parent', () => {
    const entries: StackEntry[] = [
      { branch: 'feat/ui', parent: 'feat/api', source: 'heuristic' },
      { branch: 'feat/docs', parent: 'feat/api', source: 'heuristic' },
    ];
    const forest = buildStackForest(entries, new Set(['feat/api', 'feat/ui', 'feat/docs']));

    assert.deepStrictEqual(forest.roots, ['feat/api']);
    assert.deepStrictEqual(forest.childrenOf.get('feat/api')?.sort(), ['feat/docs', 'feat/ui']);
  });
});

describe('topoOrder', () => {
  it('orders a chain bottom (root) to top', () => {
    const forest = buildStackForest(chainEntries, new Set(['feat/api', 'feat/ui', 'feat/docs']));
    assert.deepStrictEqual(topoOrder('feat/api', forest.childrenOf), ['feat/api', 'feat/ui', 'feat/docs']);
  });
});

describe('findStackContaining', () => {
  it('finds the bottom-to-top order for a branch anywhere in the stack', () => {
    const forest = buildStackForest(chainEntries, new Set(['feat/api', 'feat/ui', 'feat/docs']));
    assert.deepStrictEqual(findStackContaining('feat/docs', forest), ['feat/api', 'feat/ui', 'feat/docs']);
    assert.deepStrictEqual(findStackContaining('feat/api', forest), ['feat/api', 'feat/ui', 'feat/docs']);
  });

  it('returns undefined for a branch outside any stack', () => {
    const forest = buildStackForest(chainEntries, new Set(['feat/api', 'feat/ui', 'feat/docs', 'feat/lonely']));
    assert.strictEqual(findStackContaining('feat/lonely', forest), undefined);
  });
});
