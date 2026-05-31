import * as assert from 'assert';
import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { EnrichableItem, attachLazyEnrichment } from '../../commands/utils/enrichOnActive';

function makeRef(name: string, over: Partial<IGitRef> = {}): IGitRef {
  return { name, fullName: name, hash: `hash-${name}`, authorName: '', ...over };
}

function toItem(ref: IGitRef): EnrichableItem {
  return { label: ref.name, ref };
}

// Minimal QuickPick stand-in: records item/activeItem assignments and exposes a
// driver to fire onDidChangeActive the way VS Code would when the user navigates.
function makeFakeQuickPick() {
  let listener: ((active: EnrichableItem[]) => void) | undefined;
  const quickPick = {
    items: [] as EnrichableItem[],
    activeItems: [] as EnrichableItem[],
    onDidChangeActive(l: (active: EnrichableItem[]) => void) {
      listener = l;
      return { dispose: () => { listener = undefined; } };
    },
  };
  const fireActive = async (active: EnrichableItem[]) => {
    quickPick.activeItems = active;
    await listener?.(active);
  };
  return { quickPick, fireActive };
}

function attach(
  quickPick: ReturnType<typeof makeFakeQuickPick>['quickPick'],
  git: GitExecutor,
  rebuild: () => EnrichableItem[]
): vscode.Disposable {
  return attachLazyEnrichment({
    quickPick: quickPick as unknown as vscode.QuickPick<EnrichableItem>,
    git,
    rebuild,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('attachLazyEnrichment', () => {
  it('fetches details once per ref and serves re-highlights from cache', async () => {
    const ref = makeRef('main');
    const calls: string[] = [];
    const git = {
      getRefDetailsFast: async (r: IGitRef) => {
        calls.push(r.name);
        return { comment: 'hello' };
      },
    } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    const item = toItem(ref);
    attach(quickPick, git, () => [item]);

    await fireActive([item]);
    await fireActive([item]);

    assert.deepStrictEqual(calls, ['main']);
  });

  it('merges resolved details into the ref, repaints, and keeps the highlight', async () => {
    const ref = makeRef('main');
    const git = {
      getRefDetailsFast: async () => ({
        comment: 'Fix bug',
        authorName: 'Jane',
        committerDate: '1700000000',
      }),
    } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    let rebuilds = 0;
    attach(quickPick, git, () => {
      rebuilds++;
      return [toItem(ref)];
    });

    await fireActive([toItem(ref)]);

    assert.strictEqual(ref.comment, 'Fix bug');
    assert.strictEqual(ref.authorName, 'Jane');
    assert.strictEqual(ref.committerDate, '1700000000');
    assert.strictEqual(rebuilds, 1);
    assert.strictEqual(quickPick.activeItems[0]?.ref?.name, 'main');
  });

  it('does not repaint when the user moved on before the fetch resolved', async () => {
    const refA = makeRef('a');
    const refB = makeRef('b');
    const pendingDetails = deferred<Partial<IGitRef>>();
    const git = {
      getRefDetailsFast: async (r: IGitRef) =>
        r.name === 'a' ? pendingDetails.promise : { comment: 'B subject' },
    } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    let rebuilds = 0;
    attach(quickPick, git, () => {
      rebuilds++;
      return [toItem(refA), toItem(refB)];
    });

    const pendingA = fireActive([toItem(refA)]); // suspends awaiting refA's details
    await fireActive([toItem(refB)]); // refB resolves immediately and repaints

    pendingDetails.resolve({ comment: 'A subject' });
    await pendingA;

    assert.strictEqual(refB.comment, 'B subject');
    assert.strictEqual(refA.comment, 'A subject'); // still merged into the ref
    assert.strictEqual(rebuilds, 1); // but only refB triggered a repaint
  });

  it('leaves the row untouched when no details are resolved', async () => {
    const ref = makeRef('main');
    const git = { getRefDetailsFast: async () => undefined } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    let rebuilds = 0;
    attach(quickPick, git, () => {
      rebuilds++;
      return [toItem(ref)];
    });

    await fireActive([toItem(ref)]);

    assert.strictEqual(rebuilds, 0);
    assert.strictEqual(ref.comment, undefined);
  });

  it('ignores items without a ref (separators and actions)', async () => {
    const calls: string[] = [];
    const git = {
      getRefDetailsFast: async (r: IGitRef) => {
        calls.push(r.name);
        return { comment: 'x' };
      },
    } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    let rebuilds = 0;
    attach(quickPick, git, () => {
      rebuilds++;
      return [];
    });

    await fireActive([{ label: 'Branches', kind: vscode.QuickPickItemKind.Separator }]);

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(rebuilds, 0);
  });

  it('stops enriching after the returned disposable is disposed', async () => {
    const calls: string[] = [];
    const git = {
      getRefDetailsFast: async (r: IGitRef) => {
        calls.push(r.name);
        return { comment: 'x' };
      },
    } as unknown as GitExecutor;
    const { quickPick, fireActive } = makeFakeQuickPick();
    const sub = attach(quickPick, git, () => [toItem(makeRef('main'))]);
    sub.dispose();

    await fireActive([toItem(makeRef('main'))]);

    assert.deepStrictEqual(calls, []);
  });
});
