import * as assert from 'assert';

import { parseWorktreeListPorcelain } from '../../common/git/gitExecutor';

describe('parseWorktreeListPorcelain', () => {
  it('parses branch, detached, bare, and prunable worktrees', () => {
    const worktrees = parseWorktreeListPorcelain(
      [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo-feature',
        'HEAD def456',
        'branch refs/heads/feature/foo',
        '',
        'worktree /repo-detached',
        'HEAD 789abc',
        'detached',
        '',
        'worktree /repo-bare',
        'bare',
        '',
        'worktree /repo-prunable',
        'HEAD 000111',
        'branch refs/heads/old',
        'prunable gitdir file points to non-existent location',
        '',
      ].join('\n')
    );

    assert.deepStrictEqual(worktrees, [
      {
        path: '/repo',
        head: 'abc123',
        branch: 'refs/heads/main',
      },
      {
        path: '/repo-feature',
        head: 'def456',
        branch: 'refs/heads/feature/foo',
      },
      {
        path: '/repo-detached',
        head: '789abc',
        detached: true,
      },
      {
        path: '/repo-bare',
        bare: true,
      },
      {
        path: '/repo-prunable',
        head: '000111',
        branch: 'refs/heads/old',
        prunable: true,
      },
    ]);
  });
});
