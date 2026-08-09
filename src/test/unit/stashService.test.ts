import * as assert from 'assert';

import { IGitStash } from '../../common/git/types';
import {
  formatDropConfirmation,
  getStashFileContent,
  groupStashes,
  isAutoStash,
  isStashStale,
} from '../../services/stashService';

function makeStash(overrides: Partial<IGitStash> = {}): IGitStash {
  return {
    selector: 'stash@{0}',
    hash: 'abc123',
    message: 'WIP on main: abc123 message',
    sourceBranch: 'main',
    timestamp: Math.floor(Date.now() / 1000),
    files: ['src/a.ts'],
    ...overrides,
  };
}

describe('isAutoStash / groupStashes', () => {
  it('classifies a stash created by AutoStashService as an auto-stash', () => {
    const stash = makeStash({ message: 'auto-stash-feat/login' });
    assert.strictEqual(isAutoStash(stash), true);
  });

  it('classifies a stash whose message merely contains "auto-stash" mid-string as not an auto-stash', () => {
    // The prefix check is anchored ("auto-stash-" at the start), not a substring match.
    const stash = makeStash({ message: 'WIP on main: not-an-auto-stash-really' });
    assert.strictEqual(isAutoStash(stash), false);
  });

  it('splits a mixed list into auto-stashes and other stashes, preserving order within each group', () => {
    const auto1 = makeStash({ hash: 'a1', message: 'auto-stash-feat/login' });
    const other1 = makeStash({ hash: 'o1', message: 'WIP on main: manual work' });
    const auto2 = makeStash({ hash: 'a2', message: 'auto-stash-feat/login-2' });

    const { autoStashes, otherStashes } = groupStashes([auto1, other1, auto2]);

    assert.deepStrictEqual(autoStashes.map((s) => s.hash), ['a1', 'a2']);
    assert.deepStrictEqual(otherStashes.map((s) => s.hash), ['o1']);
  });

  it('returns empty groups for an empty stash list', () => {
    const { autoStashes, otherStashes } = groupStashes([]);
    assert.deepStrictEqual(autoStashes, []);
    assert.deepStrictEqual(otherStashes, []);
  });
});

describe('isStashStale', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('is never stale when staleAfterDays is 0 (disabled)', () => {
    const stash = makeStash({ timestamp: 0 }); // effectively ancient
    assert.strictEqual(isStashStale(stash, 0), false);
  });

  it('is never stale when staleAfterDays is negative', () => {
    const stash = makeStash({ timestamp: 0 });
    assert.strictEqual(isStashStale(stash, -5), false);
  });

  it('is not stale when younger than the threshold', () => {
    const now = Date.now();
    const stash = makeStash({ timestamp: Math.floor((now - 2 * DAY_MS) / 1000) });
    assert.strictEqual(isStashStale(stash, 7, now), false);
  });

  it('is stale once older than the threshold', () => {
    const now = Date.now();
    const stash = makeStash({ timestamp: Math.floor((now - 10 * DAY_MS) / 1000) });
    assert.strictEqual(isStashStale(stash, 7, now), true);
  });

  it('is not stale exactly at the boundary (age must exceed, not just reach, the threshold)', () => {
    // Both values are exact multiples of 1000ms so the stash-timestamp round-trip (seconds ->
    // ms) doesn't introduce sub-second drift across the boundary.
    const now = Math.floor(Date.now() / 1000) * 1000;
    const stash = makeStash({ timestamp: now / 1000 - 7 * 24 * 60 * 60 });
    assert.strictEqual(isStashStale(stash, 7, now), false);
  });
});

describe('formatDropConfirmation', () => {
  it('names the branch for a single-stash drop', () => {
    const stash = makeStash({ sourceBranch: 'feat/login' });
    assert.strictEqual(
      formatDropConfirmation([stash]),
      'Permanently drop the stash for "feat/login"?'
    );
  });

  it('falls back to the stash message when sourceBranch is unknown', () => {
    const stash = makeStash({ sourceBranch: undefined, message: 'WIP on main: abc123 fix' });
    assert.strictEqual(
      formatDropConfirmation([stash]),
      'Permanently drop the stash for "WIP on main: abc123 fix"?'
    );
  });

  it('states the count and lists every branch for a multi-select drop', () => {
    const stashes = [
      makeStash({ sourceBranch: 'feat/login' }),
      makeStash({ sourceBranch: 'feat/signup' }),
      makeStash({ sourceBranch: 'chore/deps' }),
    ];

    assert.strictEqual(
      formatDropConfirmation(stashes),
      'Permanently drop 3 stashes (feat/login, feat/signup, chore/deps)?'
    );
  });
});

describe('getStashFileContent', () => {
  it('reads the pre-stash state from the first parent for the "before" side', async () => {
    const calls: Array<[string, string]> = [];
    const git = {
      getFileAtRev: async (rev: string, path: string) => {
        calls.push([rev, path]);
        return 'original content';
      },
    };

    const content = await getStashFileContent(git, 'abc123', 'src/a.ts', 'before');

    assert.strictEqual(content, 'original content');
    assert.deepStrictEqual(calls, [['abc123^', 'src/a.ts']]);
  });

  it('renders the "before" side as empty when the file did not exist before the stash', async () => {
    const git = { getFileAtRev: async () => undefined };
    const content = await getStashFileContent(git, 'abc123', 'src/new.ts', 'before');
    assert.strictEqual(content, '');
  });

  it('reads a tracked change straight from the stash commit for the "after" side', async () => {
    const calls: Array<[string, string]> = [];
    const git = {
      getFileAtRev: async (rev: string, path: string) => {
        calls.push([rev, path]);
        return rev === 'abc123' ? 'stashed content' : undefined;
      },
    };

    const content = await getStashFileContent(git, 'abc123', 'src/a.ts', 'after');

    assert.strictEqual(content, 'stashed content');
    // Only the primary lookup is needed; the untracked-parent fallback isn't tried.
    assert.deepStrictEqual(calls, [['abc123', 'src/a.ts']]);
  });

  it('falls back to the stash\'s third parent (^3) for an untracked file the stash commit itself lacks', async () => {
    const calls: Array<[string, string]> = [];
    const git = {
      getFileAtRev: async (rev: string, path: string) => {
        calls.push([rev, path]);
        if (rev === 'abc123^3') {
          return 'untracked file content';
        }
        return undefined;
      },
    };

    const content = await getStashFileContent(git, 'abc123', 'src/token.ts', 'after');

    assert.strictEqual(content, 'untracked file content');
    assert.deepStrictEqual(calls, [
      ['abc123', 'src/token.ts'],
      ['abc123^3', 'src/token.ts'],
    ]);
  });

  it('renders the "after" side as empty when the file is missing from both the stash commit and its third parent', async () => {
    const git = { getFileAtRev: async () => undefined };
    const content = await getStashFileContent(git, 'abc123', 'src/gone.ts', 'after');
    assert.strictEqual(content, '');
  });
});
