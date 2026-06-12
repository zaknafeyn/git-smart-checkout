import * as assert from 'assert';

import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../../commands/checkoutToCommand/constants';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import { createTestRepo, TestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

const mockConfigManager = {} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function makeRef(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

describe('AutoStashService — checkoutAndStashChanges', () => {

  describe('AUTO_STASH_CURRENT_BRANCH: with changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates stash named auto-stash-{branch}, switches to target, target is clean (no matching stash to pop)', async () => {
      repo.makeChange();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(
        await repo.git.isStashWithMessageExists(`auto-stash-${repo.mainBranch}`),
        true,
        'stash for main branch should exist in list'
      );
      assert.strictEqual(
        await repo.git.isWorkdirHasChanges(),
        false,
        'no stash named auto-stash-feature exists, so nothing was popped on target'
      );
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: roundtrip A→B→A', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('restores original changes when returning to the branch where stash was created', async () => {
      repo.makeChange('file1.txt', 'roundtrip dirty content\n');

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_CURRENT_BRANCH);
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'feature should be clean');

      await sut.checkoutAndStashChanges(repo.git, repo.featureBranch, makeRef(repo.mainBranch), AUTO_STASH_CURRENT_BRANCH);
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes should be restored on main');
      assert.strictEqual(
        await repo.git.isStashWithMessageExists(`auto-stash-${repo.mainBranch}`),
        false,
        'stash was popped and removed from list'
      );
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: no changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('checkout succeeds, no stash created', async () => {
      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: with changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('switches to target branch, changes are present on target, stash list is empty after pop', async () => {
      repo.makeChange();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes should be present on feature');
      assert.strictEqual(repo.stashCount(), 0, 'pop removes the entry from the stash list');
    });
  });

  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: no changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('clean checkout, stash list remains empty', async () => {
      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: with changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('switches to target branch, changes are present on target, stash entry is preserved in list', async () => {
      repo.makeChange();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_APPLY_IN_NEW_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes should be present on feature');
      assert.strictEqual(repo.stashCount(), 1, 'apply keeps the stash entry in the list');
    });
  });

  describe('AUTO_STASH_IGNORE: clean state', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('checks out to target branch', async () => {
      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
    });
  });

  describe('tag checkout', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('checks out a tag ref (detached HEAD at the tagged commit) without error', async () => {
      // Reproduces the "Checkout to..." flow for a tag: the picked item carries
      // the tag's IGitRef, which is passed straight to checkoutAndStashChanges.
      const refs = await repo.git.getAllRefListExtended();
      const tagRef = refs.find((ref) => ref.isTag && ref.name === 'v1.0.0');
      assert.ok(tagRef, 'precondition: v1.0.0 tag ref should be listed');

      const tagSha = repo.exec('git rev-parse v1.0.0').trim();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, tagRef!, AUTO_STASH_IGNORE);

      assert.strictEqual(repo.exec('git rev-parse HEAD').trim(), tagSha, 'HEAD should be at the tagged commit');
      assert.strictEqual(repo.exec('git symbolic-ref -q HEAD || echo detached').trim(), 'detached', 'checking out a tag detaches HEAD');
    });
  });

  describe('AUTO_STASH_IGNORE: non-conflicting untracked changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('checkout succeeds and untracked file persists in working dir on target branch', async () => {
      repo.makeChange('brand-new-untracked.txt', 'untracked content\n');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'precondition: working dir should be dirty');

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'untracked file should persist after checkout');
    });
  });
});
