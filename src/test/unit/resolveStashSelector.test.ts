import * as assert from 'assert';

import { createTestRepo, TestRepo } from '../e2e/helpers/gitTestRepo';

describe('GitExecutor.resolveStashSelector', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns the selector unchanged when it still points at the expected hash', async () => {
    repo.makeChange('file1.txt', 'first stash change\n');
    await repo.git.createStash('auto-stash-main-1', 'all');

    const [stash] = await repo.git.listStashes();

    const resolved = await repo.git.resolveStashSelector(stash.selector, stash.hash);

    assert.strictEqual(resolved, stash.selector);
  });

  it('re-resolves the selector by hash when the stash index has shifted', async () => {
    // Create two stashes: stash@{1} is the older one we will "remember".
    repo.makeChange('file1.txt', 'older stash change\n');
    await repo.git.createStash('auto-stash-main-older', 'all');

    repo.makeChange('file1.txt', 'newer stash change\n');
    await repo.git.createStash('auto-stash-main-newer', 'all');

    const stashesBefore = await repo.git.listStashes();
    assert.strictEqual(stashesBefore.length, 2);

    const older = stashesBefore.find((s) => s.message === 'auto-stash-main-older');
    assert.ok(older, 'expected to find the older stash');
    assert.strictEqual(older!.selector, 'stash@{1}');

    // Simulate the list shifting elsewhere: drop the newer stash (stash@{0}),
    // which shifts the older stash from stash@{1} down to stash@{0}.
    await repo.git.dropStash('stash@{0}');

    const resolved = await repo.git.resolveStashSelector(older!.selector, older!.hash);

    assert.strictEqual(resolved, 'stash@{0}');

    const stashesAfter = await repo.git.listStashes();
    const matched = stashesAfter.find((s) => s.selector === resolved);
    assert.strictEqual(matched?.hash, older!.hash);
  });

  it('throws a friendly error when the stash no longer exists', async () => {
    repo.makeChange('file1.txt', 'a stash that will be dropped\n');
    await repo.git.createStash('auto-stash-main-gone', 'all');

    const [stash] = await repo.git.listStashes();
    await repo.git.dropStash(stash.selector);

    await assert.rejects(
      repo.git.resolveStashSelector(stash.selector, stash.hash),
      /The selected stash no longer exists\./
    );
  });
});
