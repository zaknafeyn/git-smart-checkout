import * as assert from 'assert';

import { createTestRepo, TestRepo } from '../e2e/helpers/gitTestRepo';

describe('GitExecutor.popStash hash verification', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('pops the stash matching the expected hash, not just the first message match', async () => {
    // Two stashes sharing the exact same message — the scenario from issue #206
    // (same branch stashed twice, or a stale leftover stash with the same derived name).
    const sharedMessage = 'auto-stash-main';

    repo.makeChange('file1.txt', 'first stash contents\n');
    const firstHash = await repo.git.createStash(sharedMessage, 'all');

    repo.makeChange('file1.txt', 'second stash contents\n');
    const secondHash = await repo.git.createStash(sharedMessage, 'all');

    assert.notStrictEqual(firstHash, secondHash, 'the two stashes must have distinct hashes');

    const stashesBefore = await repo.git.listStashes();
    assert.strictEqual(stashesBefore.length, 2);
    // Both share the derived message.
    assert.ok(stashesBefore.every((s) => s.message === sharedMessage));

    // Without hash verification, popStash would always resolve to stash@{0} — the
    // most-recently-created stash happens to occupy that slot here, so pop the *first*
    // one created (now at a higher index) via its known hash to prove the hash wins.
    await repo.git.popStash(sharedMessage, false, firstHash);

    const stashesAfter = await repo.git.listStashes();
    assert.strictEqual(stashesAfter.length, 1, 'exactly one stash should remain');
    assert.strictEqual(stashesAfter[0].hash, secondHash, 'the remaining stash must be the second one, not the popped first one');

    assert.strictEqual(repo.readFile('file1.txt'), 'first stash contents\n');
  });

  it('throws instead of popping a guess when the expected hash matches no stash', async () => {
    const sharedMessage = 'auto-stash-main';

    repo.makeChange('file1.txt', 'only stash contents\n');
    await repo.git.createStash(sharedMessage, 'all');

    await assert.rejects(
      repo.git.popStash(sharedMessage, false, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
      /Could not verify the stash "auto-stash-main"/
    );

    // The stash must be left untouched.
    const stashesAfter = await repo.git.listStashes();
    assert.strictEqual(stashesAfter.length, 1);
  });
});
