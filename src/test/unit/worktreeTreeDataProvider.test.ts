import * as assert from 'assert';
import * as os from 'os';
import { WorktreeTreeDataProvider, WorktreeTreeItem } from '../../view/WorktreeTreeDataProvider';
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('WorktreeTreeItem', () => {
  it('renders a pending state before enrichment resolves', () => {
    const item = new WorktreeTreeItem(
      { path: '/repo', branch: 'refs/heads/main', head: 'abcdef123456' },
      '/repo',
      true
    );

    assert.strictEqual(item.label, 'main');
    // No dirty marker, arrows, or PR-review badge yet — just the path.
    assert.strictEqual(item.description, '/repo');
    assert.strictEqual(item.contextValue, 'worktree main');
    assert.ok((item.iconPath as { id: string }).id === 'repo');
  });

  it('describes dirty, tracked, and PR-review worktrees once enriched', () => {
    const item = new WorktreeTreeItem(
      { path: '/repo/review', branch: 'refs/heads/feature', head: 'abcdef123456' },
      '/repo',
      false
    );

    item.applyEnrichment({ isDirty: true, dirtyFileCount: 3, track: [2, 1], isPrReview: true });

    assert.strictEqual(item.label, 'feature');
    assert.strictEqual(item.description, '/repo/review ⇡2 ⇣1 ● PR review');
    assert.strictEqual(item.contextValue, 'worktree linked dirty prReview');
    assert.ok((item.iconPath as { id: string }).id === 'git-pull-request');
    assert.ok(String(item.tooltip).includes('Dirty files: 3'));
    assert.ok(String(item.tooltip).includes('Tracked as a PR-review worktree'));
  });

  it('marks a clean linked worktree with the clean contextValue and folder-library icon', () => {
    const item = new WorktreeTreeItem(
      { path: '/repo/linked', branch: 'refs/heads/chore', head: 'abcdef123456' },
      '/repo',
      false
    );

    item.applyEnrichment({ isDirty: false, dirtyFileCount: 0, isPrReview: false });

    assert.strictEqual(item.contextValue, 'worktree linked clean');
    assert.ok((item.iconPath as { id: string }).id === 'folder-library');
    assert.strictEqual(item.description, '/repo/linked');
  });

  it('uses a short SHA and the detached tag for detached-HEAD worktrees', () => {
    const item = new WorktreeTreeItem({ path: '/repo/detached', head: 'abcdef123456' }, '/repo', false);

    item.applyEnrichment({ isDirty: false, dirtyFileCount: 0, isPrReview: false });

    assert.strictEqual(item.label, 'abcdef12');
    assert.strictEqual(item.contextValue, 'worktree linked detached clean');
    assert.ok(String(item.tooltip).includes('Detached HEAD'));
  });

  it('shortens a home-directory path with a tilde', () => {
    const home = os.homedir();
    const item = new WorktreeTreeItem(
      { path: `${home}/projects/repo-review`, branch: 'refs/heads/feature' },
      home,
      false
    );

    item.applyEnrichment({ isDirty: false, dirtyFileCount: 0, isPrReview: false });

    assert.strictEqual(item.description, '~/projects/repo-review');
  });
});

describe('WorktreeTreeDataProvider.refreshDebounced', () => {
  function makeProvider() {
    const store = { getForRepository: async () => [] } as unknown as PRReviewWorktreeStore;
    return new WorktreeTreeDataProvider(mockLogService, store);
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

  it('does not fire before the debounce window elapses', async () => {
    const provider = makeProvider();
    let fireCount = 0;
    provider.onDidChangeTreeData(() => fireCount++);

    provider.refreshDebounced(50);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(fireCount, 0);

    await new Promise((resolve) => setTimeout(resolve, 60));
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
    // The pending debounced refresh must not fire a second time.
    assert.strictEqual(fireCount, 1);
    provider.dispose();
  });
});
