import * as assert from 'assert';

import { IGitWorktree } from '../../common/git/types';
import {
  getRemovableWorktrees,
  getWorktreeDetail,
  getWorktreeLabel,
} from '../../commands/utils/worktreeRemoval';

describe('getRemovableWorktrees', () => {
  it('excludes the main worktree and keeps linked worktrees', () => {
    const worktrees: IGitWorktree[] = [
      { path: '/repo', head: 'abc1234', branch: 'refs/heads/main' },
      { path: '/repo-feature', head: 'def4567', branch: 'refs/heads/feature/foo' },
      { path: '/repo-bugfix', head: '7890abc', branch: 'refs/heads/bugfix/bar' },
    ];

    const removable = getRemovableWorktrees(worktrees);

    assert.deepStrictEqual(
      removable.map((worktree) => worktree.path),
      ['/repo-feature', '/repo-bugfix']
    );
  });

  it('excludes bare and prunable worktrees', () => {
    const worktrees: IGitWorktree[] = [
      { path: '/repo', head: 'abc1234', branch: 'refs/heads/main' },
      { path: '/repo-bare', bare: true },
      { path: '/repo-stale', head: 'def4567', branch: 'refs/heads/stale', prunable: true },
      { path: '/repo-feature', head: '7890abc', branch: 'refs/heads/feature/foo' },
    ];

    const removable = getRemovableWorktrees(worktrees);

    assert.deepStrictEqual(
      removable.map((worktree) => worktree.path),
      ['/repo-feature']
    );
  });

  it('returns an empty list when only the main worktree exists', () => {
    const worktrees: IGitWorktree[] = [
      { path: '/repo', head: 'abc1234', branch: 'refs/heads/main' },
    ];

    assert.deepStrictEqual(getRemovableWorktrees(worktrees), []);
  });
});

describe('getWorktreeLabel / getWorktreeDetail', () => {
  it('labels branch worktrees with the branch name', () => {
    assert.strictEqual(
      getWorktreeLabel({ path: '/repo-feature', head: 'def4567', branch: 'refs/heads/feature/foo' }),
      'feature/foo'
    );
  });

  it('labels detached worktrees with the short head', () => {
    const worktree: IGitWorktree = { path: '/repo-detached', head: '7890abcdef', detached: true };
    assert.strictEqual(getWorktreeLabel(worktree), 'Detached at 7890abc');
    assert.strictEqual(getWorktreeDetail(worktree), 'Detached HEAD 7890abc');
  });
});
