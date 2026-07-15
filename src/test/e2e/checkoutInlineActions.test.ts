import * as assert from 'assert';
import * as vscode from 'vscode';

import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import {
  createTagTestRepo,
  createTestRepo,
  createWorktreeTestRepo,
  TagTestRepo,
  TestRepo,
  WorktreeTestRepo,
} from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

function makeRef(name: string, overrides: Partial<IGitRef> = {}): IGitRef {
  return { name, fullName: name, authorName: '', isTag: false, ...overrides };
}

/** Exposes the protected inline-action methods for direct e2e testing against a real repo. */
class TestableCheckoutToCommand extends CheckoutToCommand {
  infoMessages: string[] = [];
  errorMessages: string[] = [];

  constructor() {
    super({} as ConfigurationManager, mockLogService, {} as AutoStashService);
  }

  protected async showInformationMessage(message: string): Promise<string | undefined> {
    this.infoMessages.push(message);
    return undefined;
  }

  protected async showErrorMessage(message: string): Promise<string | undefined> {
    this.errorMessages.push(message);
    return undefined;
  }

  callDelete(git: GitExecutor, ref: IGitRef, currentBranch: string) {
    return this.handleItemButtonAction(git, 'repo', currentBranch, [ref], ref, 'delete');
  }

  callRename(git: GitExecutor, ref: IGitRef, currentBranch: string) {
    return this.handleItemButtonAction(git, 'repo', currentBranch, [ref], ref, 'rename');
  }

  callPush(git: GitExecutor, ref: IGitRef, currentBranch: string) {
    return this.handleItemButtonAction(git, 'repo', currentBranch, [ref], ref, 'push');
  }
}

function stubDialog<T extends 'showWarningMessage' | 'showInputBox'>(
  method: T,
  value: unknown
): () => void {
  const original = vscode.window[method];
  (vscode.window as any)[method] = async () => value;
  return () => {
    (vscode.window as any)[method] = original;
  };
}

function branchExists(repo: TestRepo, branch: string): boolean {
  const out = repo.exec(`git branch --list ${branch}`);
  return out.trim().length > 0;
}

describe('CheckoutToCommand inline branch actions (e2e, real git repo)', () => {
  describe('delete decision matrix', () => {
    let repo: TestRepo;
    beforeEach(() => {
      repo = createTestRepo();
    });
    afterEach(() => repo.cleanup());

    it('deletes a merged branch immediately, without any confirmation prompt', async () => {
      repo.exec(`git checkout ${repo.mainBranch}`);
      repo.exec('git checkout -b done');
      repo.exec(`git checkout ${repo.mainBranch}`);
      repo.exec('git merge --no-ff done -m "merge done"');

      const command = new TestableCheckoutToCommand();
      const restoreWarning = stubDialog('showWarningMessage', (() => {
        throw new Error('should not prompt for a merged branch');
      }) as unknown as string);

      try {
        const mutated = await command.callDelete(repo.git, makeRef('done'), repo.mainBranch);
        assert.strictEqual(mutated, true);
      } finally {
        restoreWarning();
      }

      assert.strictEqual(branchExists(repo, 'done'), false, 'merged branch should be gone');
      assert.ok(command.infoMessages.some((m) => m.includes('done')), 'a "Deleted branch" toast should be shown');
    });

    it('prompts before deleting an unmerged branch, and deletes on confirm', async () => {
      // `feature` (from createTestRepo) has a commit not on main — unmerged.
      const restoreWarning = stubDialog('showWarningMessage', 'Delete');
      const command = new TestableCheckoutToCommand();

      try {
        const mutated = await command.callDelete(repo.git, makeRef(repo.featureBranch), repo.mainBranch);
        assert.strictEqual(mutated, true);
      } finally {
        restoreWarning();
      }

      assert.strictEqual(branchExists(repo, repo.featureBranch), false, 'unmerged branch should be force-deleted');
    });

    it('leaves an unmerged branch untouched and shows no error toast when the confirmation is dismissed (Escape)', async () => {
      const restoreWarning = stubDialog('showWarningMessage', undefined);
      const command = new TestableCheckoutToCommand();

      try {
        const mutated = await command.callDelete(repo.git, makeRef(repo.featureBranch), repo.mainBranch);
        assert.strictEqual(mutated, false);
      } finally {
        restoreWarning();
      }

      assert.strictEqual(branchExists(repo, repo.featureBranch), true, 'branch should still exist');
      assert.deepStrictEqual(command.errorMessages, [], 'dismissing a confirmation must not show an error toast');
    });

    it('blocks deleting the currently checked out branch with an explanatory message, no git call', async () => {
      const command = new TestableCheckoutToCommand();

      const mutated = await command.callDelete(repo.git, makeRef(repo.mainBranch), repo.mainBranch);

      assert.strictEqual(mutated, false);
      assert.strictEqual(branchExists(repo, repo.mainBranch), true);
      assert.strictEqual(command.errorMessages.length, 1);
      assert.ok(command.errorMessages[0].includes(repo.mainBranch));
    });
  });

  describe('worktree conflict on delete', () => {
    let repo: WorktreeTestRepo;
    beforeEach(() => {
      repo = createWorktreeTestRepo();
    });
    afterEach(() => repo.cleanup());

    it('surfaces the worktree-conflict flow instead of a raw git error, and does not delete the branch', async () => {
      const restoreInfo = stubDialog('showWarningMessage', 'Delete');
      // handleWorktreeBranchConflict uses showInformationMessage (not showWarningMessage);
      // stub it to simulate the user dismissing that dialog (Escape).
      const originalShowInformationMessage = vscode.window.showInformationMessage;
      (vscode.window as any).showInformationMessage = async () => undefined;

      const command = new TestableCheckoutToCommand();

      try {
        const mutated = await command.callDelete(repo.git, makeRef(repo.worktreeBranch), repo.mainBranch);
        assert.strictEqual(mutated, false);
      } finally {
        restoreInfo();
        (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      }

      assert.strictEqual(
        branchExists(repo, repo.worktreeBranch),
        true,
        'branch checked out in another worktree must not be deleted'
      );
    });
  });

  describe('rename', () => {
    let repo: TestRepo;
    beforeEach(() => {
      repo = createTestRepo();
    });
    afterEach(() => repo.cleanup());

    it('renames the branch and the new name shows up in `git branch`', async () => {
      const originalShowInputBox = vscode.window.showInputBox;
      (vscode.window as any).showInputBox = async () => 'feature-renamed';

      const command = new TestableCheckoutToCommand();
      try {
        const mutated = await command.callRename(repo.git, makeRef(repo.featureBranch), repo.mainBranch);
        assert.strictEqual(mutated, true);
      } finally {
        (vscode.window as any).showInputBox = originalShowInputBox;
      }

      assert.strictEqual(branchExists(repo, repo.featureBranch), false);
      assert.strictEqual(branchExists(repo, 'feature-renamed'), true);
    });
  });

  describe('publish', () => {
    let repo: TagTestRepo;
    beforeEach(() => {
      repo = createTagTestRepo();
    });
    afterEach(() => repo.cleanup());

    it('pushes and sets upstream for a local-only branch', async () => {
      repo.exec('git checkout -b publish-me');

      const command = new TestableCheckoutToCommand();
      const mutated = await command.callPush(repo.git, makeRef('publish-me'), 'publish-me');
      assert.strictEqual(mutated, true);

      const remoteBranches = repo.exec(`git ls-remote --heads "${repo.remoteRepoPath}" publish-me`);
      assert.ok(remoteBranches.includes('publish-me'), 'branch should have been pushed to the remote');

      const upstream = repo.exec('git for-each-ref --format="%(upstream:short)" refs/heads/publish-me').trim();
      assert.strictEqual(upstream, 'origin/publish-me');
    });
  });
});
