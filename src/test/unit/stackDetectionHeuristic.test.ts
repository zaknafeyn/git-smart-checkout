import * as assert from 'assert';

import {
  computeLocalAncestryParents,
  heuristicEntriesFrom,
} from '../../services/stackDetectionService';

/**
 * Fixture: a 3-branch chain rooted at trunk.
 *   main -> feat/api -> feat/ui -> feat/docs
 * Ancestor relationships are transitive (main is an ancestor of all three;
 * feat/api is an ancestor of feat/ui and feat/docs; feat/ui is an ancestor
 * of feat/docs only). Distances (commit counts) increase with "chain
 * distance" so the closest valid ancestor always wins.
 */
function chainFixture() {
  const ancestors: Record<string, string[]> = {
    'feat/api': ['main'],
    'feat/ui': ['main', 'feat/api'],
    'feat/docs': ['main', 'feat/api', 'feat/ui'],
  };
  const isAncestor = (a: string, b: string) => (ancestors[b] ?? []).includes(a);
  // Distance grows the further back in the chain `a` is from `b`.
  const distance = (a: string, b: string) => {
    const chain = ['main', 'feat/api', 'feat/ui', 'feat/docs'];
    return chain.indexOf(b) - chain.indexOf(a);
  };
  return { isAncestor, distance };
}

describe('computeLocalAncestryParents', () => {
  it('picks the closest ancestor as parent for a linear chain', () => {
    const { isAncestor, distance } = chainFixture();

    const result = computeLocalAncestryParents({
      branches: ['feat/api', 'feat/ui', 'feat/docs'],
      trunk: 'main',
      isAncestor,
      distance,
    });

    // feat/api's only ancestor is trunk -> not stacked (no entry).
    assert.strictEqual(result.has('feat/api'), false);
    // feat/ui's closest ancestor is feat/api (not trunk, which is further).
    assert.strictEqual(result.get('feat/ui'), 'feat/api');
    // feat/docs's closest ancestor is feat/ui (closer than feat/api or trunk).
    assert.strictEqual(result.get('feat/docs'), 'feat/ui');
  });

  it('excludes a branch with no non-trunk ancestor', () => {
    const result = computeLocalAncestryParents({
      branches: ['feat/lonely'],
      trunk: 'main',
      isAncestor: (a, b) => a === 'main' && b === 'feat/lonely',
      distance: () => 5,
    });

    assert.strictEqual(result.size, 0);
  });

  it('ignores a candidate with zero commits between tips (identical tips)', () => {
    const result = computeLocalAncestryParents({
      branches: ['feat/a', 'feat/b'],
      trunk: 'main',
      isAncestor: () => true,
      distance: (a, b) => (a === 'feat/a' && b === 'feat/b' ? 0 : 3),
    });

    // feat/a==feat/b distance 0 is skipped; falls back to the next best
    // candidate (main, or feat/b->feat/a) whichever has a positive distance.
    assert.notStrictEqual(result.get('feat/b'), 'feat/a');
  });

  it('supports branches with multiple children (a tree, not just a chain)', () => {
    const isAncestor = (a: string, b: string): boolean => {
      if (a === 'main') {
        return true;
      }
      if (a === 'feat/api') {
        return b === 'feat/ui' || b === 'feat/docs';
      }
      return false;
    };
    // feat/api is always closer (fewer commits) to its children than trunk is.
    const distance = (a: string): number => (a === 'feat/api' ? 1 : 5);

    const result = computeLocalAncestryParents({
      branches: ['feat/api', 'feat/ui', 'feat/docs'],
      trunk: 'main',
      isAncestor,
      distance,
    });

    assert.strictEqual(result.get('feat/ui'), 'feat/api');
    assert.strictEqual(result.get('feat/docs'), 'feat/api');
  });
});

describe('heuristicEntriesFrom', () => {
  it('converts a parent map into StackEntry[] tagged as heuristic', () => {
    const parents = new Map([
      ['feat/ui', 'feat/api'],
      ['feat/docs', 'feat/ui'],
    ]);

    const entries = heuristicEntriesFrom(parents);

    assert.strictEqual(entries.length, 2);
    assert.ok(entries.every((e) => e.source === 'heuristic'));
    const uiEntry = entries.find((e) => e.branch === 'feat/ui');
    assert.strictEqual(uiEntry?.parent, 'feat/api');
  });

  it('returns an empty array for an empty map', () => {
    assert.deepStrictEqual(heuristicEntriesFrom(new Map()), []);
  });
});
