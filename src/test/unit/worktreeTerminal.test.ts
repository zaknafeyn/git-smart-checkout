import * as assert from 'assert';

import { IGitWorktree } from '../../common/git/types';
import {
  buildWorktreeTerminalItems,
  getWorktreeTerminalName,
} from '../../commands/utils/worktreeTerminal';

describe('buildWorktreeTerminalItems', () => {
  const worktrees: IGitWorktree[] = [
    { path: '/repo', head: 'abc123', branch: 'refs/heads/main' },
    { path: '/repo-feature', head: 'def456', branch: 'refs/heads/feature/foo' },
    { path: '/repo-detached', head: '789abc', detached: true },
  ];

  it('uses branch names as labels and worktree paths as descriptions', () => {
    const items = buildWorktreeTerminalItems(worktrees, '/repo');

    const feature = items.find((item) => item.worktreePath === '/repo-feature');
    assert.ok(feature);
    assert.strictEqual(feature.label, 'feature/foo');
    assert.strictEqual(feature.description, '/repo-feature');
  });

  it('marks the current worktree and sorts it first', () => {
    const items = buildWorktreeTerminalItems(worktrees, '/repo-feature');

    assert.strictEqual(items[0].worktreePath, '/repo-feature');
    assert.strictEqual(items[0].label, 'feature/foo (current)');
    assert.ok(!items.slice(1).some((item) => item.label.includes('(current)')));
  });

  it('falls back to a detached label for detached worktrees', () => {
    const items = buildWorktreeTerminalItems(worktrees, '/repo');

    const detached = items.find((item) => item.worktreePath === '/repo-detached');
    assert.ok(detached);
    assert.strictEqual(detached.label, '(detached HEAD)');
  });
});

describe('getWorktreeTerminalName', () => {
  it('returns the branch name when present', () => {
    assert.strictEqual(
      getWorktreeTerminalName({ path: '/repo-feature', branch: 'refs/heads/feature/foo' }),
      'feature/foo'
    );
  });

  it('falls back to the directory basename for detached worktrees', () => {
    assert.strictEqual(
      getWorktreeTerminalName({ path: '/some/path/repo-detached', detached: true }),
      'repo-detached'
    );
  });
});
