import * as assert from 'assert';

import { createRebaseConflictTestRepo, TestRepo } from './helpers/gitTestRepo';

/**
 * isCherryPickInProgress() must detect an in-progress cherry-pick by checking
 * for the CHERRY_PICK_HEAD ref (the previous implementation grepped human-readable
 * status text that never appears in porcelain output, so it always returned false).
 *
 * createRebaseConflictTestRepo gives main and feature divergent committed versions
 * of file1.txt, so cherry-picking feature's tip onto main conflicts and leaves the
 * cherry-pick in progress.
 */
describe('GitExecutor.isCherryPickInProgress', () => {
  let repo: TestRepo;
  before(() => {
    repo = createRebaseConflictTestRepo();
    repo.exec('git checkout main');
  });
  after(() => { repo.cleanup(); });

  it('returns false when no cherry-pick is in progress', async () => {
    assert.strictEqual(await repo.git.isCherryPickInProgress(), false);
  });

  it('returns true while a conflicting cherry-pick is in progress', async () => {
    // Cherry-pick feature's tip onto main; conflicts on file1.txt and stops mid-pick.
    try {
      repo.exec('git cherry-pick feature');
    } catch {
      // expected: conflict makes cherry-pick exit non-zero
    }

    assert.strictEqual(await repo.git.isCherryPickInProgress(), true, 'CHERRY_PICK_HEAD should exist after a conflicting cherry-pick');
  });

  it('returns false again after the cherry-pick is aborted', async () => {
    repo.exec('git cherry-pick --abort');

    assert.strictEqual(await repo.git.isCherryPickInProgress(), false, 'CHERRY_PICK_HEAD should be gone after abort');
  });
});
