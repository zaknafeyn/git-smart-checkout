import * as assert from 'assert';

import { resolveStashArg } from '../../commands/utils/resolveStashArg';
import { StashTreeItem } from '../../view/StashTreeDataProvider';
import { IGitStash } from '../../common/git/types';

function makeStash(overrides: Partial<IGitStash> = {}): IGitStash {
  return {
    selector: 'stash@{0}',
    hash: 'abc123',
    message: 'auto-stash-feat/login',
    sourceBranch: 'feat/login',
    timestamp: Math.floor(Date.now() / 1000),
    files: ['src/a.ts'],
    ...overrides,
  };
}

describe('resolveStashArg', () => {
  it('returns undefined for an unrelated argument', () => {
    assert.strictEqual(resolveStashArg({ notAStash: true }), undefined);
  });

  it('resolves a single clicked stash item', () => {
    const item = new StashTreeItem(makeStash(), '/repo', 7);
    const resolved = resolveStashArg(item);

    assert.ok(resolved);
    assert.strictEqual(resolved?.repositoryPath, '/repo');
    assert.strictEqual(resolved?.stashes.length, 1);
    assert.strictEqual(resolved?.stashes[0].hash, 'abc123');
  });

  it('resolves every selected item when a multi-select array is passed', () => {
    const first = new StashTreeItem(makeStash({ hash: 'a1' }), '/repo', 7);
    const second = new StashTreeItem(makeStash({ hash: 'a2' }), '/repo', 7);

    const resolved = resolveStashArg(first, [first, second]);

    assert.ok(resolved);
    assert.deepStrictEqual(resolved?.stashes.map((stash) => stash.hash), ['a1', 'a2']);
  });

  it('falls back to the single clicked item when the selection array is empty', () => {
    const item = new StashTreeItem(makeStash({ hash: 'solo' }), '/repo', 7);
    const resolved = resolveStashArg(item, []);

    assert.ok(resolved);
    assert.deepStrictEqual(resolved?.stashes.map((stash) => stash.hash), ['solo']);
  });
});
