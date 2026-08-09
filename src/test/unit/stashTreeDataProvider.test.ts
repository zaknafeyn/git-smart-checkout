import * as assert from 'assert';

import {
  StashFileTreeItem,
  StashGroupTreeItem,
  StashTreeDataProvider,
  StashTreeItem,
} from '../../view/StashTreeDataProvider';
import { IGitStash } from '../../common/git/types';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeStash(overrides: Partial<IGitStash> = {}): IGitStash {
  return {
    selector: 'stash@{0}',
    hash: 'abc123',
    message: 'auto-stash-feat/login',
    sourceBranch: 'feat/login',
    timestamp: Math.floor(Date.now() / 1000),
    files: ['src/auth/login.ts', 'src/auth/token.ts'],
    ...overrides,
  };
}

describe('StashGroupTreeItem', () => {
  it('labels the auto-stash group with a count', () => {
    const item = new StashGroupTreeItem('auto', '/repo', [makeStash(), makeStash({ hash: 'def' })]);
    assert.strictEqual(item.label, 'Auto-stashes (2)');
    assert.strictEqual(item.contextValue, 'stashGroup autoStashes');
  });

  it('labels the other-stashes group with a count', () => {
    const item = new StashGroupTreeItem('other', '/repo', [makeStash()]);
    assert.strictEqual(item.label, 'Other stashes (1)');
    assert.strictEqual(item.contextValue, 'stashGroup otherStashes');
  });
});

describe('StashTreeItem', () => {
  it('describes a fresh stash without a stale marker', () => {
    const stash = makeStash({ timestamp: Math.floor(Date.now() / 1000) - 60 * 60 });
    const item = new StashTreeItem(stash, '/repo', 7);

    assert.strictEqual(item.label, 'feat/login');
    assert.strictEqual(item.isStale, false);
    assert.ok(!String(item.description).includes('stale'));
    assert.strictEqual(item.contextValue, 'stash');
  });

  it('flags a stash older than the configured staleAfterDays threshold', () => {
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    const stash = makeStash({ timestamp: tenDaysAgo });
    const item = new StashTreeItem(stash, '/repo', 7);

    assert.strictEqual(item.isStale, true);
    assert.ok(String(item.description).includes('⚠ stale'));
    assert.ok(String(item.tooltip).includes('staleness threshold'));
  });

  it('never flags a stash as stale when staleAfterDays is 0', () => {
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    const stash = makeStash({ timestamp: tenDaysAgo });
    const item = new StashTreeItem(stash, '/repo', 0);

    assert.strictEqual(item.isStale, false);
  });

  it('falls back to the stash message when sourceBranch is unavailable', () => {
    const stash = makeStash({ sourceBranch: undefined, message: 'WIP on develop: 9f3ab2 msg' });
    const item = new StashTreeItem(stash, '/repo', 7);
    assert.strictEqual(item.label, 'WIP on develop: 9f3ab2 msg');
  });
});

describe('StashFileTreeItem', () => {
  it('prefixes the label with the file status and wires a diff command', () => {
    const stash = makeStash();
    const item = new StashFileTreeItem(stash, '/repo', 'src/auth/login.ts', 'M');

    assert.strictEqual(item.label, 'M src/auth/login.ts');
    assert.strictEqual(item.command?.command, 'vscode.diff');
    assert.strictEqual(item.command?.arguments?.length, 3);
  });
});

describe('StashTreeDataProvider.getChildren', () => {
  function makeProvider(onAutoStashCountChanged?: (count: number) => void) {
    return new StashTreeDataProvider(mockLogService, () => 7, undefined, onAutoStashCountChanged);
  }

  it('returns no groups when there are no workspace folders', async () => {
    const provider = makeProvider();
    const children = await provider.getChildren();
    assert.deepStrictEqual(children, []);
  });

  it('reports an auto-stash count of 0 when nothing loads', async () => {
    let reportedCount: number | undefined;
    const provider = makeProvider((count) => {
      reportedCount = count;
    });
    await provider.getChildren();
    assert.strictEqual(reportedCount, 0);
  });
});

describe('StashTreeDataProvider.refreshDebounced', () => {
  function makeProvider() {
    return new StashTreeDataProvider(mockLogService, () => 7);
  }

  it('coalesces rapid refresh calls into a single reload', async () => {
    const provider = makeProvider();
    let fireCount = 0;
    provider.onDidChangeTreeData(() => fireCount++);

    for (let i = 0; i < 5; i++) {
      provider.refreshDebounced(30);
    }

    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.strictEqual(fireCount, 1);
    provider.dispose();
  });

  it('refresh() fires immediately and cancels a pending debounce', async () => {
    const provider = makeProvider();
    let fireCount = 0;
    provider.onDidChangeTreeData(() => fireCount++);

    provider.refreshDebounced(50);
    provider.refresh();
    assert.strictEqual(fireCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.strictEqual(fireCount, 1);
    provider.dispose();
  });
});
