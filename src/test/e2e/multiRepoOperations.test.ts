import * as assert from 'assert';
import * as vscode from 'vscode';

import { IGitStash } from '../../common/git/types';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';

import {
  commandId,
  delay,
  ensureExtensionActivated,
  QuickPickLikeItem,
  selectRepositoryByName,
  setExtensionMode,
  stubCreateQuickPick,
  stubErrorMessages,
  stubInformationMessages,
  stubShowQuickPick,
  visualPause,
  withMultiRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo } from './helpers/gitTestRepo';

function pickLocalBranch(branchName: string) {
  return (items: readonly QuickPickLikeItem[]) =>
    items.find((item) => item.ref?.name === branchName && !item.ref.remote && !item.ref.isTag);
}

describe('Multi-repository workspace operations', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  beforeEach(async () => {
    // Use a fixed stash mode so checkoutTo does not prompt for mode selection.
    await setExtensionMode(AUTO_STASH_MODE_BRANCH);
  });

  describe('checkoutTo', () => {
    it('switches branches in the selected repository and leaves the other untouched', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      const errors = stubErrorMessages();
      const restorePick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return selectRepositoryByName(items, repoA);
        }
        return undefined;
      });
      const restoreBranchPick = stubCreateQuickPick(pickLocalBranch(repoA.featureBranch));

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          await visualPause();

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repoA.git.getCurrentBranch(), repoA.featureBranch);
          assert.strictEqual(
            await repoB.git.getCurrentBranch(),
            repoB.mainBranch,
            'repo B should remain on its original branch'
          );
        });
      } finally {
        errors.restore();
        restorePick();
        restoreBranchPick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });

    it('creates an auto-stash only in the selected repository', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      repoA.makeChange('file1.txt', 'dirty content in A\n');
      repoB.makeChange('file1.txt', 'dirty content in B\n');
      const errors = stubErrorMessages();
      const restorePick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return selectRepositoryByName(items, repoA);
        }
        return undefined;
      });
      const restoreBranchPick = stubCreateQuickPick(pickLocalBranch(repoA.featureBranch));

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          await visualPause();

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(repoA.stashCount(), 1, 'repo A should have one auto-stash');
          assert.strictEqual(repoB.stashCount(), 0, 'repo B should have no stashes');
          assert.strictEqual(
            await repoB.git.isWorkdirHasChanges(),
            true,
            'repo B dirty changes should be untouched'
          );
        });
      } finally {
        errors.restore();
        restorePick();
        restoreBranchPick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });
  });

  describe('copyBranchName', () => {
    it('copies the branch name of the selected repository', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      await repoA.git.checkout(repoA.featureBranch);
      const errors = stubErrorMessages();
      const restorePick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return selectRepositoryByName(items, repoA);
        }
        return undefined;
      });

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('copyBranchName'));
          await delay();

          assert.deepStrictEqual(errors.messages, []);
          const copied = await vscode.env.clipboard.readText();
          assert.strictEqual(
            copied,
            repoA.featureBranch,
            'clipboard should contain the branch of the selected repo'
          );
        });
      } finally {
        errors.restore();
        restorePick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });

    it('copies the branch name of the second repository when that one is selected', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      repoB.exec(`git checkout ${repoB.featureBranch}`);
      const errors = stubErrorMessages();
      const restorePick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return selectRepositoryByName(items, repoB);
        }
        return undefined;
      });

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('copyBranchName'));
          await delay();

          assert.deepStrictEqual(errors.messages, []);
          const copied = await vscode.env.clipboard.readText();
          assert.strictEqual(copied, repoB.featureBranch);
        });
      } finally {
        errors.restore();
        restorePick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });
  });

  describe('manageAutoStashes', () => {
    it('lists only the stashes from the selected repository', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      const stashMessageA = `auto-stash-${repoA.mainBranch}: repo-A stash`;
      const stashMessageB = `auto-stash-${repoB.mainBranch}: repo-B stash`;
      repoA.makeChange('file1.txt', 'content A\n');
      await repoA.git.createStash(stashMessageA);
      repoB.makeChange('file1.txt', 'content B\n');
      await repoB.git.createStash(stashMessageB);

      let inspectedItems: readonly (vscode.QuickPickItem & { stash?: IGitStash })[] = [];
      const errors = stubErrorMessages();
      const info = stubInformationMessages(() => undefined);
      const restorePick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return selectRepositoryByName(items, repoA);
        }
        if (options?.placeHolder === 'Select an auto-stash') {
          inspectedItems = items as readonly (vscode.QuickPickItem & { stash?: IGitStash })[];
          return undefined;
        }
        return undefined;
      });

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('manageAutoStashes'));
          await delay();

          assert.deepStrictEqual(errors.messages, []);
          const messages = inspectedItems.map((item) => item.stash?.message ?? '');
          assert.ok(
            messages.some((m) => m.includes('repo-A stash')),
            'should include repo A stash'
          );
          assert.ok(
            !messages.some((m) => m.includes('repo-B stash')),
            'should not include repo B stash'
          );
        });
      } finally {
        errors.restore();
        info.restore();
        restorePick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });
  });

  describe('repo picker cancelled', () => {
    it('surfaces an error and leaves both repositories unchanged', async () => {
      const repoA = createTestRepo();
      const repoB = createTestRepo();
      const errors = stubErrorMessages();
      const restorePick = stubShowQuickPick((_items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return undefined; // simulates user pressing Escape
        }
        return undefined;
      });

      try {
        await withMultiRepoWorkspace([repoA, repoB], async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.ok(
            errors.messages.some((m) => m.includes('No repository selected')),
            'should report that no repository was selected'
          );
          assert.strictEqual(await repoA.git.getCurrentBranch(), repoA.mainBranch);
          assert.strictEqual(await repoB.git.getCurrentBranch(), repoB.mainBranch);
          assert.strictEqual(repoA.stashCount(), 0);
          assert.strictEqual(repoB.stashCount(), 0);
        });
      } finally {
        errors.restore();
        restorePick();
        repoA.cleanup();
        repoB.cleanup();
      }
    });
  });
});
