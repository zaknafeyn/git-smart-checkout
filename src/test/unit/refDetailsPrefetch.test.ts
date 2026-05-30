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
    assert.strictEqual(refs[19].comment, 'subject branch-19');
    assert.strictEqual(refs[20].comment, undefined);
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
