import * as assert from 'assert';
import { WorktreeTreeItem } from '../../view/WorktreeTreeDataProvider';

describe('WorktreeTreeItem', () => {
  it('describes dirty, tracked, and PR-review worktrees', () => {
    const item = new WorktreeTreeItem(
      { path: '/repo/review', branch: 'refs/heads/feature', head: 'abcdef123456' },
      '/repo',
      true,
      [2, 1],
      true
    );
    assert.strictEqual(item.label, 'feature');
    assert.strictEqual(item.description, '/repo/review ⇡2 ⇣1 ● PR review');
    assert.strictEqual(item.contextValue, 'worktree.prReview');
  });

  it('uses a short SHA for detached worktrees', () => {
    const item = new WorktreeTreeItem(
      { path: '/repo/detached', head: 'abcdef123456' },
      '/repo',
      false
    );
    assert.strictEqual(item.label, 'abcdef12');
  });
});
