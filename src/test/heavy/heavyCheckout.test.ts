import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../../commands/checkoutToCommand/constants';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import { createHeavyTestRepo, HeavyTestRepo } from '../e2e/helpers/gitTestRepo';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Heavy-repository coverage for checkout + auto-stash. Each test runs over a
 * ~28-file repo whose working tree carries staged, unstaged, mixed, untracked,
 * deleted and renamed changes at once, switching to a feature branch that
 * touches a disjoint set of files (so pop/apply never conflicts by accident).
 */

const mockConfigManager = {
  get: () => ({ pullAfterCheckout: 'ffOnly' }),
} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function makeRef(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

function stubWarning(answer: string | undefined): () => void {
  const prev = vscode.window.showWarningMessage.bind(vscode.window);
  (vscode.window as any).showWarningMessage = async () => answer;
  return () => { (vscode.window as any).showWarningMessage = prev; };
}

describe('Heavy repo — checkout + auto stash', () => {
  describe('AUTO_STASH_CURRENT_BRANCH over a complex working tree', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('stashes all working changes on the source branch and lands clean on the target', async () => {
      const state = repo.seedComplexWorkingState();
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'precondition: tree is dirty');

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.uiBranch), AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.uiBranch);
      assert.strictEqual(repo.stashCount(), 1, 'one stash created for the source branch');
      assert.strictEqual(
        await repo.git.isStashWithMessageExists(`auto-stash-${repo.mainBranch}`),
        true,
        'stash is named after the source branch'
      );
      // Target had no matching auto-stash, so the working tree is clean.
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'target branch is clean');
      assert.strictEqual(repo.fileExists(state.untracked[0]), false, 'untracked WIP was stashed away');
      assert.strictEqual(repo.fileExists(state.renamed.to), false, 'rename was stashed away');
      assert.strictEqual(repo.fileExists('src/components/Sidebar.ts'), true, 'target branch files are present');
    });

    it('restores every change on the round trip back to the source branch', async () => {
      // Continue from the previous test: we are on uiBranch with auto-stash-main pending.
      await sut.checkoutAndStashChanges(repo.git, repo.uiBranch, makeRef(repo.mainBranch), AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(repo.stashCount(), 0, 'stash popped on return');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes restored on source');
      assert.ok(repo.readFile('src/utils/validate.ts').includes('// staged edit'), 'staged edit restored');
      assert.ok(repo.readFile('src/services/cacheService.ts').includes('// unstaged edit'), 'unstaged edit restored');
      assert.strictEqual(repo.fileExists('src/utils/wipHelper.ts'), true, 'untracked WIP restored');
      assert.strictEqual(repo.fileExists('src/hooks/useToggle.ts'), false, 'deletion restored');
      assert.strictEqual(repo.fileExists('tests/fixtures.renamed.ts'), true, 'rename restored');
      assert.strictEqual(repo.fileExists('tests/fixtures.ts'), false, 'old name still gone');
    });
  });

  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH over a complex working tree', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('moves all working changes onto the target branch and empties the stash list', async () => {
      const state = repo.seedComplexWorkingState();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.apiBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.apiBranch);
      assert.strictEqual(repo.stashCount(), 0, 'pop consumes the stash');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes present on target');
      assert.ok(repo.readFile(state.staged[0]).includes('// staged edit'), 'staged content moved');
      assert.ok(repo.readFile(state.modifiedUnstaged[0]).includes('// unstaged edit'), 'unstaged content moved');
      assert.strictEqual(repo.fileExists(state.untracked[0]), true, 'untracked WIP moved');
      assert.strictEqual(repo.fileExists(state.deleted[0]), false, 'deletion moved');
      assert.strictEqual(repo.fileExists('src/services/webhookService.ts'), true, 'target branch file present');
    });
  });

  describe('AUTO_STASH_AND_APPLY_IN_NEW_BRANCH over a complex working tree', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('copies the changes onto the target branch while preserving the stash', async () => {
      const state = repo.seedComplexWorkingState();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.uiBranch), AUTO_STASH_AND_APPLY_IN_NEW_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.uiBranch);
      assert.strictEqual(repo.stashCount(), 1, 'apply keeps the stash entry');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes present on target');
      assert.ok(repo.readFile(state.staged[1]).includes('// staged edit'), 'staged content applied');
    });
  });

  describe('AUTO_STASH_IGNORE over a complex working tree', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('carries non-conflicting changes across the checkout without stashing', async () => {
      const state = repo.seedComplexWorkingState();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.uiBranch), AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.uiBranch);
      assert.strictEqual(repo.stashCount(), 0, 'no stash created');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'changes persist after checkout');
      assert.strictEqual(repo.fileExists(state.untracked[1]), true, 'untracked WIP persists');
    });
  });

  describe('checkout to a remote-only branch', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('creates a local tracking branch from origin and checks it out', async () => {
      await repo.git.fetchAllRemoteBranchesAndTags();

      await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.prBranch), AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.prBranch);
      assert.strictEqual(repo.fileExists('src/features/prFeature.ts'), true, 'remote-only branch content present');
    });
  });

  describe('stash conflict prediction blocks a risky pop', () => {
    let repo: HeavyTestRepo;
    before(() => { repo = createHeavyTestRepo(); });
    after(() => { repo.cleanup(); });

    it('cancels the checkout when the user declines the predicted conflict', async () => {
      // Dirty exactly the file that the conflict branch also rewrote.
      repo.makeChange(repo.conflictFile, '// working tree rewrite of format\nexport const format = 1;\n');
      const restoreWarning = stubWarning(undefined); // user declines

      try {
        await sut.checkoutAndStashChanges(
          repo.git,
          repo.mainBranch,
          makeRef(repo.conflictBranch),
          AUTO_STASH_AND_POP_IN_NEW_BRANCH
        );

        assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch, 'branch unchanged');
        assert.strictEqual(repo.stashCount(), 0, 'no stash created when cancelled');
      } finally {
        restoreWarning();
      }
    });
  });
});
