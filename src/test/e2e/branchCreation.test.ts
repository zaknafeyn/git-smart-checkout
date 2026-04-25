import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { createConflictTestRepo, createTestRepo, TestRepo } from './helpers/gitTestRepo';

describe('GitExecutor.createBranch', () => {

  describe('from current HEAD (no source)', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates branch and switches to it', async () => {
      await repo.git.createBranch('new-branch');

      assert.strictEqual(await repo.git.getCurrentBranch(), 'new-branch');
    });
  });

  describe('from current HEAD with uncommitted changes', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates branch, switches to it, uncommitted changes are preserved', async () => {
      repo.makeChange('file1.txt', 'work in progress\n');

      await repo.git.createBranch('wip-branch');

      assert.strictEqual(await repo.git.getCurrentBranch(), 'wip-branch');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes travel with the working dir on branch creation');
    });
  });

  describe('from a specific source branch', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates branch based on source, switches to it, source files are present', async () => {
      // feature branch has feature.txt which main does not
      await repo.git.createBranch('derived-from-feature', repo.featureBranch);

      assert.strictEqual(await repo.git.getCurrentBranch(), 'derived-from-feature');
      assert.ok(
        fs.existsSync(path.join(repo.repoPath, 'feature.txt')),
        'feature.txt from source branch should be present'
      );
    });
  });
});

describe('createNewBranchFrom stash pattern', () => {

  /**
   * Simulates what createNewBranchFrom does internally:
   *   1. stash changes under a timestamped name
   *   2. create branch from a source
   *   3. pop the stash
   * Verifies that changes are transferred to the new branch.
   */
  describe('with uncommitted changes, non-conflicting source', () => {
    let repo: TestRepo;
    before(() => { repo = createTestRepo(); });
    after(() => { repo.cleanup(); });

    it('stashes changes, creates branch from source, pops stash — changes present on new branch', async () => {
      repo.makeChange('file1.txt', 'work in progress\n');
      const stashName = `smart-checkout-new-branch-${Date.now()}`;

      await repo.git.createStash(stashName);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'working dir clean after stash');

      await repo.git.createBranch('feature-from-main', repo.featureBranch);
      assert.strictEqual(await repo.git.getCurrentBranch(), 'feature-from-main');

      await repo.git.popStash(stashName);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes present on new branch after pop');
      assert.strictEqual(repo.stashCount(), 0, 'stash entry removed after successful pop');
    });
  });

  /**
   * When the stash pop conflicts (source branch has diverging content), the conflict
   * is silently swallowed by createNewBranchFrom — the function still returns the new
   * branch. Conflict markers are left in the working dir for the user to resolve.
   */
  describe('with uncommitted changes, conflicting source', () => {
    let repo: TestRepo;
    before(() => { repo = createConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates branch, pop conflict is silenced, conflict markers left for user to resolve', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');
      const stashName = `smart-checkout-new-branch-${Date.now()}`;

      await repo.git.createStash(stashName);
      await repo.git.createBranch('feature-from-feature', repo.featureBranch);
      assert.strictEqual(await repo.git.getCurrentBranch(), 'feature-from-feature');

      // Mimics the silent catch in createNewBranchFrom: swallow the conflict error
      try {
        await repo.git.popStash(stashName);
      } catch {
        // conflicts are left for the user to resolve
      }

      // New branch was created successfully
      assert.strictEqual(await repo.git.getCurrentBranch(), 'feature-from-feature');
      // Working dir is dirty due to conflict markers
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflict markers present after failed pop');
    });
  });
});
