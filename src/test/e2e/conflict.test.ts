import * as assert from 'assert';
import * as vscode from 'vscode';

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

const mockConfigManager = {
  get: () => ({ pullAfterCheckout: 'ffOnly' }),
} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function makeRef(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

// Stubs window.showWarningMessage for the duration of the test suite.
// Returns a restore function to call in after().
function stubConflictDialog(answer: string | undefined): () => void {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  (vscode.window as any).showWarningMessage = async () => answer;
  return () => { (vscode.window as any).showWarningMessage = original; };
}

/**
 * Stubs window.showWarningMessage to answer each successive call with the next
 * entry in `answers` (the last entry repeats once exhausted), while recording
 * every message shown so tests can assert on rescue-notification wording.
 */
function stubWarningSequence(answers: (string | undefined)[]): {
  messages: string[];
  restore: () => void;
} {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  const messages: string[] = [];
  let call = 0;
  (vscode.window as any).showWarningMessage = async (message: string) => {
    messages.push(message);
    const answer = answers[Math.min(call, answers.length - 1)];
    call++;
    return answer;
  };
  return {
    messages,
    restore: () => { (vscode.window as any).showWarningMessage = original; },
  };
}

describe('AutoStashService — stash pop/apply conflicts', () => {

  /**
   * AUTO_STASH_AND_POP_IN_NEW_BRANCH: stash from main contains a change to file1.txt
   * (based on "initial content"). feature has file1.txt = "feature version of file1".
   * Popping the stash on feature conflicts. Per the stash-pop conflict rescue flow,
   * checkoutAndStashChanges no longer throws a generic error — it resolves with
   * outcome "rescued" and shows the rescue notification instead. The stash entry is
   * retained because git stash pop does not drop the entry on conflict.
   * The first dialog (predicted-conflict warning) is answered 'Continue'; the second
   * (rescue notification) is answered with nothing selected.
   */
  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: conflicting changes — user continues', () => {
    let repo: TestRepo;
    let dialog: { messages: string[]; restore: () => void };
    before(() => {
      repo = createConflictTestRepo();
      dialog = stubWarningSequence(['Continue', undefined]);
    });
    after(() => { dialog.restore(); repo.cleanup(); });

    it('does not throw, checkout happened, rescue notification shown, stash entry retained', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      const outcome = await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(outcome, 'rescued');
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch, 'checkout happened before the pop conflict');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflict markers left in working dir');
      assert.strictEqual(repo.stashCount(), 1, 'stash entry retained because pop failed on conflict');

      const rescueMessage = dialog.messages[dialog.messages.length - 1];
      assert.match(rescueMessage, /Stash restored with conflicts: \d+ file\(s\) need resolution/);
      assert.match(rescueMessage, /stash was preserved because pop conflicted/);
    });
  });

  /**
   * AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: same conflict scenario.
   * apply always retains the stash entry regardless of success or failure.
   */
  describe('AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: conflicting changes — user continues', () => {
    let repo: TestRepo;
    let dialog: { messages: string[]; restore: () => void };
    before(() => {
      repo = createConflictTestRepo();
      dialog = stubWarningSequence(['Continue', undefined]);
    });
    after(() => { dialog.restore(); repo.cleanup(); });

    it('does not throw, checkout happened, rescue notification shown (apply wording), stash retained', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      const outcome = await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_APPLY_IN_NEW_BRANCH);

      assert.strictEqual(outcome, 'rescued');
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch, 'checkout happened before the apply conflict');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflict markers left in working dir');
      assert.strictEqual(repo.stashCount(), 1, 'stash entry retained (apply never removes it)');

      const rescueMessage = dialog.messages[dialog.messages.length - 1];
      assert.match(rescueMessage, /Stash restored with conflicts: \d+ file\(s\) need resolution/);
      assert.match(rescueMessage, /stash is preserved because apply never removes it/);
    });
  });

  /**
   * AUTO_STASH_AND_POP_IN_NEW_BRANCH: conflict detected, user cancels.
   * The operation must abort before any state mutation: no checkout, no stash.
   */
  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: conflicting changes — user cancels', () => {
    let repo: TestRepo;
    let restoreDialog: () => void;
    before(() => {
      repo = createConflictTestRepo();
      restoreDialog = stubConflictDialog('Cancel');
    });
    after(() => { restoreDialog(); repo.cleanup(); });

    it('stays on original branch, working tree unchanged, no stash created', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      const outcome = await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(outcome, 'cancelled');
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch, 'still on main — checkout was aborted');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'local changes preserved');
      assert.strictEqual(repo.stashCount(), 0, 'no stash was created');
    });
  });

  /**
   * AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: conflict detected, user cancels.
   */
  describe('AUTO_STASH_AND_APPLY_IN_NEW_BRANCH: conflicting changes — user cancels', () => {
    let repo: TestRepo;
    let restoreDialog: () => void;
    before(() => {
      repo = createConflictTestRepo();
      restoreDialog = stubConflictDialog('Cancel');
    });
    after(() => { restoreDialog(); repo.cleanup(); });

    it('stays on original branch, working tree unchanged, no stash created', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      const outcome = await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_APPLY_IN_NEW_BRANCH);

      assert.strictEqual(outcome, 'cancelled');
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch, 'still on main — checkout was aborted');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'local changes preserved');
      assert.strictEqual(repo.stashCount(), 0, 'no stash was created');
    });
  });

  /**
   * AUTO_STASH_CURRENT_BRANCH: stash is named auto-stash-{branch}. On the outbound
   * leg (main → feature) no pop is attempted because no stash named "auto-stash-feature"
   * exists. On the return leg (feature → main) the stash "auto-stash-main" IS popped,
   * but because the stash was taken before the conflict divergence it applies cleanly.
   * This test verifies the full roundtrip succeeds even in a conflict-prone repo.
   * No dialog stub needed — this mode does not use doAutoStashAndPopInNewBranch.
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

  /**
   * "Undo (keep stash)": after a conflicted pop, choosing Undo runs `git reset --merge`,
   * leaving the working tree clean while the stash entry (the auto-stash) remains
   * available via "GSC: Manage auto-stashes...".
   */
  describe('AUTO_STASH_AND_POP_IN_NEW_BRANCH: conflicting changes — Undo (keep stash)', () => {
    let repo: TestRepo;
    let dialog: { messages: string[]; restore: () => void };
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    before(() => {
      repo = createConflictTestRepo();
      // First dialog: predicted-conflict warning -> Continue. Second: rescue notification -> Undo.
      dialog = stubWarningSequence(['Continue', 'Undo (keep stash)']);
      // Undo shows a follow-up information message; stub it so the promise resolves
      // instead of waiting indefinitely for a real UI dismissal.
      originalShowInformationMessage = vscode.window.showInformationMessage;
      (vscode.window as any).showInformationMessage = async () => undefined;
    });
    after(() => {
      dialog.restore();
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      repo.cleanup();
    });

    it('cleans the working tree via reset --merge and keeps the auto-stash entry', async () => {
      repo.makeChange('file1.txt', 'main dirty change\n');

      const outcome = await sut.checkoutAndStashChanges(repo.git, repo.mainBranch, makeRef(repo.featureBranch), AUTO_STASH_AND_POP_IN_NEW_BRANCH);

      assert.strictEqual(outcome, 'rescued');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'working tree cleaned up by reset --merge');
      assert.strictEqual(repo.stashCount(), 1, 'auto-stash is preserved and reachable via Manage auto-stashes');
    });
  });
});
