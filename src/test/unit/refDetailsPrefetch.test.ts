import * as assert from 'assert';
import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { EnrichableItem } from '../../commands/utils/enrichOnActive';
import {
  prepareInitialRefDetails,
  refreshRefDetails,
  refreshRemainingRefDetails,
} from '../../commands/utils/refDetailsPrefetch';
import { RefDetailsCache } from '../../services/refDetailsCache';

function makeMemoryMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

function makeRef(index: number): IGitRef {
  return {
    name: `branch-${index}`,
    fullName: `branch-${index}`,
    hash: `hash-${index}`,
    authorName: '',
  };
}

function makeGit(calls: string[]): GitExecutor {
  return {
    getRefDetailsFast: async (ref: IGitRef) => {
      calls.push(ref.name);
      return {
        hash: `${ref.hash}-display`,
        comment: `subject ${ref.name}`,
        authorName: `author ${ref.name}`,
        committerDate: '1700000000',
      };
    },
  } as unknown as GitExecutor;
}

function buildItems(refs: IGitRef[]): EnrichableItem[] {
  return [
    { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
    ...refs.map((ref) => ({ label: ref.name, ref })),
  ];
}

function buildGroupedItems(refs: IGitRef[]): EnrichableItem[] {
  return [
    { label: 'Create new branch...' },
    { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
    { label: refs[2].name, ref: refs[2] },
    { label: refs[0].name, ref: refs[0] },
    { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
    { label: refs[1].name, ref: refs[1] },
  ];
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('refDetailsPrefetch', () => {
  it('enriches only the first 20 selectable refs before display', async () => {
    const refs = Array.from({ length: 25 }, (_, index) => makeRef(index));
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildItems(refs),
    });

    assert.deepStrictEqual(calls, refs.slice(0, 20).map((ref) => ref.name));
    assert.strictEqual(refs[0].comment, 'subject branch-0');
    assert.strictEqual(refs[0].authorName, 'author branch-0');
    assert.strictEqual(refs[0].committerDate, '1700000000');
    assert.strictEqual(refs[0].hash, 'hash-0-display');
    assert.strictEqual(refs[19].comment, 'subject branch-19');
    assert.strictEqual(refs[20].comment, undefined);
  });

  it('prefetches refs in displayed selectable order while ignoring actions and separators', async () => {
    const refs = [makeRef(0), makeRef(1), makeRef(2)];
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildGroupedItems(refs),
    });

    assert.deepStrictEqual(calls, ['branch-2', 'branch-0', 'branch-1']);
  });

  it('uses cached top refs without fetching them again', async () => {
    const refs = Array.from({ length: 3 }, (_, index) => makeRef(index));
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());
    await cache.upsert('repo', refs[0], { comment: 'cached subject' });

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildItems(refs),
    });

    assert.strictEqual(refs[0].comment, 'cached subject');
    assert.deepStrictEqual(calls, ['branch-1', 'branch-2']);
  });

  it('refreshes a cached branch when the branch hash changes before showing the list', async () => {
    const refs = [makeRef(0)];
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());

    await cache.upsert('repo', makeRef(0), { comment: 'old cached subject' });
    refs[0].hash = 'new-hash-0';

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildItems(refs),
    });

    assert.deepStrictEqual(calls, ['branch-0']);
    assert.strictEqual(refs[0].comment, 'subject branch-0');
    assert.strictEqual(refs[0].hash, 'new-hash-0-display');
  });

  it('uses cached branch details after a previous refresh populated the cache', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const firstOpenRefs = [makeRef(0)];
    const firstCalls: string[] = [];

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs: firstOpenRefs,
      git: makeGit(firstCalls),
      cache,
      buildItems: () => buildItems(firstOpenRefs),
    });

    const secondOpenRefs = [makeRef(0)];
    const secondCalls: string[] = [];
    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs: secondOpenRefs,
      git: makeGit(secondCalls),
      cache,
      buildItems: () => buildItems(secondOpenRefs),
    });

    assert.deepStrictEqual(firstCalls, ['branch-0']);
    assert.deepStrictEqual(secondCalls, []);
    assert.strictEqual(secondOpenRefs[0].comment, 'subject branch-0');
    assert.strictEqual(secondOpenRefs[0].authorName, 'author branch-0');
  });

  it('refreshes remaining missing refs in the background and repaints', async () => {
    const refs = Array.from({ length: 22 }, (_, index) => makeRef(index));
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());
    const quickPick = {
      activeItems: [] as EnrichableItem[],
      items: [] as EnrichableItem[],
    } as unknown as vscode.QuickPick<EnrichableItem>;
    let rebuilds = 0;

    await prepareInitialRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildItems(refs),
    });
    calls.length = 0;

    refreshRemainingRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit(calls),
      cache,
      buildItems: () => buildItems(refs),
      quickPick,
      rebuild: () => {
        rebuilds++;
        return buildItems(refs);
      },
    });
    await waitForMicrotasks();

    assert.deepStrictEqual(calls, ['branch-20', 'branch-21']);
    assert.strictEqual(refs[20].comment, 'subject branch-20');
    assert.ok(rebuilds >= 1);
  });

  it('does not fetch or repaint background refs when all remaining refs are cached', async () => {
    const refs = Array.from({ length: 22 }, (_, index) => makeRef(index));
    const cache = new RefDetailsCache(makeMemoryMemento());
    const quickPick = {
      activeItems: [] as EnrichableItem[],
      items: [] as EnrichableItem[],
    } as unknown as vscode.QuickPick<EnrichableItem>;
    let rebuilds = 0;

    for (const ref of refs) {
      await cache.upsert('repo', ref, { comment: `cached ${ref.name}` });
    }

    refreshRemainingRefDetails({
      repoKey: 'repo',
      refs,
      git: makeGit([]),
      cache,
      buildItems: () => buildItems(refs),
      quickPick,
      rebuild: () => {
        rebuilds++;
        return buildItems(refs);
      },
    });
    await waitForMicrotasks();

    assert.strictEqual(rebuilds, 0);
  });

  it('focused enrichment writes through the persistent cache', async () => {
    const ref = makeRef(1);
    const calls: string[] = [];
    const cache = new RefDetailsCache(makeMemoryMemento());

    await refreshRefDetails('repo', makeGit(calls), cache, ref);

    assert.strictEqual(ref.comment, 'subject branch-1');
    assert.deepStrictEqual(cache.get('repo', makeRef(1)), {
      hash: 'hash-1-display',
      comment: 'subject branch-1',
      authorName: 'author branch-1',
      committerDate: '1700000000',
    });
  });
});
