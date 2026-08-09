import * as assert from 'assert';

import { parseStatusPorcelainPaths } from '../../common/git/gitExecutor';
import { IGitRef, IGitWorktree, TUpstreamTrack } from '../../common/git/types';
import {
  findPrunableWorktrees,
  formatPruneConfirmationDetail,
  MAX_DIRTY_FILES_SHOWN,
  PrunableWorktree,
} from '../../services/worktreePruneService';

function worktree(overrides: Partial<IGitWorktree> & Pick<IGitWorktree, 'path'>): IGitWorktree {
  return { head: 'abcdef1234567890', ...overrides };
}

function ref(name: string, parsedUpstreamTrack: TUpstreamTrack, overrides: Partial<IGitRef> = {}): IGitRef {
  return {
    authorName: 'Test',
    name,
    fullName: `refs/heads/${name}`,
    parsedUpstreamTrack,
    ...overrides,
  };
}

const mainWorktree = worktree({ path: '/repo', branch: 'refs/heads/main' });

describe('findPrunableWorktrees', () => {
  it('keeps only worktrees whose branch upstream is gone', () => {
    const gone = worktree({ path: '/repo-gone', branch: 'refs/heads/feat/gone' });
    const alive = worktree({ path: '/repo-alive', branch: 'refs/heads/feat/alive' });

    const result = findPrunableWorktrees(
      [mainWorktree, gone, alive],
      [ref('main', [0, 0]), ref('feat/gone', 'gone'), ref('feat/alive', [1, 2])]
    );

    assert.deepStrictEqual(
      result.map((item) => item.path),
      ['/repo-gone']
    );
  });

  it('never prunes the main worktree even when its upstream is gone', () => {
    const result = findPrunableWorktrees([mainWorktree], [ref('main', 'gone')]);

    assert.deepStrictEqual(result, []);
  });

  it('skips bare and already-prunable entries', () => {
    const bare = worktree({ path: '/repo-bare', branch: 'refs/heads/feat/bare', bare: true });
    const stale = worktree({ path: '/repo-stale', branch: 'refs/heads/feat/stale', prunable: true });

    const result = findPrunableWorktrees(
      [mainWorktree, bare, stale],
      [ref('feat/bare', 'gone'), ref('feat/stale', 'gone')]
    );

    assert.deepStrictEqual(result, []);
  });

  it('skips detached-HEAD worktrees, which have no branch to delete', () => {
    const detached = worktree({ path: '/repo-detached', detached: true });

    const result = findPrunableWorktrees([mainWorktree, detached], [ref('feat/gone', 'gone')]);

    assert.deepStrictEqual(result, []);
  });

  it('ignores branches with an ahead/behind tuple or no upstream at all', () => {
    const behind = worktree({ path: '/repo-behind', branch: 'refs/heads/feat/behind' });
    const untracked = worktree({ path: '/repo-untracked', branch: 'refs/heads/feat/untracked' });

    const result = findPrunableWorktrees(
      [mainWorktree, behind, untracked],
      [ref('feat/behind', [0, 3]), ref('feat/untracked', undefined)]
    );

    assert.deepStrictEqual(result, []);
  });

  it('does not match a remote ref or a tag that happens to share the branch name', () => {
    const candidate = worktree({ path: '/repo-x', branch: 'refs/heads/feat/x' });

    const result = findPrunableWorktrees(
      [mainWorktree, candidate],
      [
        ref('feat/x', 'gone', { remote: 'origin' }),
        ref('feat/x', 'gone', { isTag: true }),
      ]
    );

    assert.deepStrictEqual(result, []);
  });
});

describe('parseStatusPorcelainPaths', () => {
  it('returns an empty list for clean output', () => {
    assert.deepStrictEqual(parseStatusPorcelainPaths(''), []);
    assert.deepStrictEqual(parseStatusPorcelainPaths('\n'), []);
  });

  it('extracts the path from each status line', () => {
    const output = [' M src/a.ts', 'A  src/b.ts', '?? notes.md', 'MM src/c.ts', ''].join('\n');

    assert.deepStrictEqual(parseStatusPorcelainPaths(output), [
      'src/a.ts',
      'src/b.ts',
      'notes.md',
      'src/c.ts',
    ]);
  });

  it('reports the destination path of a rename or copy', () => {
    const output = ['R  src/old.ts -> src/new.ts', 'C  src/a.ts -> src/b.ts'].join('\n');

    assert.deepStrictEqual(parseStatusPorcelainPaths(output), ['src/new.ts', 'src/b.ts']);
  });

  it('keeps paths that contain spaces intact', () => {
    assert.deepStrictEqual(parseStatusPorcelainPaths(' M src/my file.ts'), ['src/my file.ts']);
  });

  it('unquotes C-quoted paths', () => {
    assert.deepStrictEqual(parseStatusPorcelainPaths('?? "src/say \\"hi\\".ts"'), [
      'src/say "hi".ts',
    ]);
  });
});

describe('formatPruneConfirmationDetail', () => {
  const clean: PrunableWorktree = {
    worktree: worktree({ path: '/wt/clean', branch: 'refs/heads/feat/clean' }),
    branch: 'feat/clean',
    dirtyFiles: [],
  };

  it('lists a clean worktree as a single bullet', () => {
    assert.strictEqual(formatPruneConfirmationDetail([clean]), '• feat/clean (/wt/clean)');
  });

  it('spells out the dirty file names under the worktree', () => {
    const dirty: PrunableWorktree = {
      worktree: worktree({ path: '/wt/dirty', branch: 'refs/heads/feat/dirty' }),
      branch: 'feat/dirty',
      dirtyFiles: ['src/a.ts', 'src/b.ts'],
    };

    assert.strictEqual(
      formatPruneConfirmationDetail([dirty]),
      [
        '• feat/dirty (/wt/dirty)',
        '    2 uncommitted files:',
        '      - src/a.ts',
        '      - src/b.ts',
      ].join('\n')
    );
  });

  it('uses the singular form for a single dirty file', () => {
    const dirty: PrunableWorktree = { ...clean, dirtyFiles: ['src/only.ts'] };

    assert.ok(formatPruneConfirmationDetail([dirty]).includes('1 uncommitted file:'));
  });

  it(`shows at most ${MAX_DIRTY_FILES_SHOWN} files and elides the rest`, () => {
    const dirtyFiles = Array.from({ length: MAX_DIRTY_FILES_SHOWN + 3 }, (_, i) => `src/f${i}.ts`);
    const detail = formatPruneConfirmationDetail([{ ...clean, dirtyFiles }]);

    assert.ok(detail.includes(`- src/f${MAX_DIRTY_FILES_SHOWN - 1}.ts`));
    assert.ok(!detail.includes(`- src/f${MAX_DIRTY_FILES_SHOWN}.ts`));
    assert.ok(detail.includes('…and 3 more'));
  });

  it('joins multiple worktrees with newlines', () => {
    const other: PrunableWorktree = {
      worktree: worktree({ path: '/wt/other', branch: 'refs/heads/feat/other' }),
      branch: 'feat/other',
      dirtyFiles: [],
    };

    assert.strictEqual(
      formatPruneConfirmationDetail([clean, other]),
      '• feat/clean (/wt/clean)\n• feat/other (/wt/other)'
    );
  });
});
