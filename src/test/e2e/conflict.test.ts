import * as assert from 'assert';

import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
} from '../../commands/checkoutToCommand/constants';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import { createConflictTestRepo, TestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

const mockConfigManager = {} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function makeRef(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

describe('AutoStashService — stash pop/apply conflicts', () => {

  /**
   * AUTO_STASH_AND_POP_IN_NEW_BRANCH: stash from main contains a change to file1.txt
   * (based on "initial content"). feature has file1.txt = "feature version of file1".
   * Popping the stash on feature conflicts → checkoutAndStashChanges throws, stash
   * entry is retained because git stash pop does not drop the entry on conflict.
   */
  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: conflicting changes', () => {
    let repo: TestRepo;
    before(() => { repo = createConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('throws an error, checkout still happened, stash entry is retained', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      await assert.rejects(
        () => sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH),
        /Failed to pop the stash on the new branch/
      );

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch, 'checkout happened before the pop error');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflict markers left in working dir');
      assert.strictEqual(repo.stashCount(), 1, 'stash entry retained because pop failed on conflict');
    });
  });

  /**
   * AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: same conflict scenario.
   * apply always retains the stash entry regardless of success or failure.
   */
  describe('AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: conflicting changes', () => {
    let repo: TestRepo;
    before(() => { repo = createConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('throws an error, checkout still happened, stash entry is retained', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      await assert.rejects(
        () => sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_APPLY_IN_NEW_BRANCH),
        /Failed to apply the stash on the new branch/
      );

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch, 'checkout happened before the apply error');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflict markers left in working dir');
      assert.strictEqual(repo.stashCount(), 1, 'stash entry retained (apply never removes it)');
    });
  });

  /**
   * AUTO_STASH_CURRENT_BRANCH: stash is named auto-stash-{branch}. On the outbound
   * leg (main → feature) no pop is attempted because no stash named "auto-stash-feature"
   * exists. On the return leg (feature → main) the stash "auto-stash-main" IS popped,
   * but because the stash was taken before the conflict divergence it applies cleanly.
   * This test verifies the full roundtrip succeeds even in a conflict-prone repo.
   */
  describe('AUTO_STASH_CURRENT_BRANCH: roundtrip in conflict-prone repo', () => {
    let repo: TestRepo;
    before(() => { repo = createConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('outbound leg (main→feature) leaves no pop — return leg restores changes on main', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      // main → feature: stash saved under auto-stash-main, nothing popped on feature
      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_CURRENT_BRANCH);
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'feature is clean — no matching stash was popped');

      // feature → main: stash auto-stash-main is found and popped (applies cleanly on main's base)
      await sut.checkoutAndStashChanges(repo.git, repo.featureBranch, makeRef(repo.mainBranch), AUTO_STASH_CURRENT_BRANCH);
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'original changes restored on main');
      assert.strictEqual(repo.stashCount(), 0, 'stash entry removed after successful pop');
    });
  });
});
