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

import {
  createTestRepo,
  createTwoRemoteTestRepo,
  TestRepo,
  TwoRemoteTestRepo,
} from './helpers/gitTestRepo';
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

describe('GitExecutor — remote-branch existence checks (two remotes)', () => {
  let repo: TwoRemoteTestRepo;
  beforeEach(() => { repo = createTwoRemoteTestRepo(); });
  afterEach(() => { repo.cleanup(); });

  it('branchExist detects a remote-only branch present on origin', async () => {
    // Precondition: the branch must not exist locally.
    assert.strictEqual(
      repo.fileExists('feat.txt'),
      false,
      'precondition: feat branch is not checked out locally'
    );

    assert.strictEqual(
      await repo.git.branchExist(repo.remoteOnlyBranch),
      true,
      'a branch that only exists on origin should be detected by branchExist'
    );
  });

  it('branchExist returns false for a name that exists on no remote and no local ref', async () => {
    assert.strictEqual(await repo.git.branchExist('does-not-exist-anywhere'), false);
  });

  it('checkout creates a local tracking branch from the named remote when the branch is remote-only', async () => {
    // `feat` exists on both origin and upstream, so a bare `git checkout feat`
    // would be ambiguous. checkout() must take the "create -b from <remote>/<branch>"
    // path, which depends on the remote-existence check resolving correctly.
    await repo.git.checkout(repo.remoteOnlyBranch, 'origin');

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.remoteOnlyBranch);
    assert.strictEqual(
      repo.fileExists('feat.txt'),
      true,
      'the remote feat branch content should now be present locally'
    );

    const upstream = repo.exec(
      `git rev-parse --abbrev-ref ${repo.remoteOnlyBranch}@{upstream}`
    ).trim();
    assert.strictEqual(
      upstream,
      `origin/${repo.remoteOnlyBranch}`,
      'the local branch should track origin, not upstream'
    );
  });
});
