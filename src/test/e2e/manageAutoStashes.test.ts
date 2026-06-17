import * as assert from 'assert';
import * as vscode from 'vscode';

import { IGitStash } from '../../common/git/types';
import {
  commandId,
  delay,
  ensureExtensionActivated,
  stubErrorMessages,
  stubInformationMessages,
  stubShowQuickPick,
  stubWarningMessages,
  withRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

type ManagerQuickPickItem = vscode.QuickPickItem & {
  stash?: IGitStash;
  action?: 'apply' | 'pop' | 'diff' | 'drop';
};

async function createAutoStash(
  repo: TestRepo,
  message = 'auto-stash-main-2026-06-14T12:34:56',
  filename = 'file1.txt',
  content = 'stashed content\n'
): Promise<void> {
  repo.makeChange(filename, content);
  await repo.git.createStash(message);
}

describe('Manage auto-stashes command', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  it('lists only auto-stashes with branch, age, and changed files', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo, 'manual checkpoint');
    await createAutoStash(
      repo,
      'auto-stash-main: recovery checkpoint',
      'file with spaces.txt',
      'untracked recovery\n'
    );
    let inspected = false;
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      assert.strictEqual(options?.placeHolder, 'Select an auto-stash');
      const managerItems = items as readonly ManagerQuickPickItem[];
      assert.strictEqual(managerItems.length, 1);

      const item = managerItems[0];
      assert.strictEqual(item.stash?.message, 'auto-stash-main: recovery checkpoint');
      assert.strictEqual(item.stash?.sourceBranch, repo.mainBranch);
      assert.deepStrictEqual(item.stash?.files, ['file with spaces.txt']);
      assert.ok(item.label.includes(repo.mainBranch));
      assert.ok(item.description?.includes('1 file'));
      assert.ok(item.detail?.includes('file with spaces.txt'));
      inspected = true;
      return undefined;
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));
        assert.strictEqual(inspected, true);
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('applies a stash, retains it, and refreshes the stash picker', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo);
    let stashPickerCount = 0;
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      const managerItems = items as readonly ManagerQuickPickItem[];
      if (options?.placeHolder === 'Select an auto-stash') {
        stashPickerCount++;
        return stashPickerCount === 1 ? managerItems[0] : undefined;
      }
      if (options?.placeHolder === 'Select an action') {
        return managerItems.find((item) => item.action === 'apply');
      }
      return undefined;
    });
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));

        assert.strictEqual(repo.readFile('file1.txt'), 'stashed content\n');
        assert.strictEqual(repo.stashCount(), 1, 'apply should retain the stash');
        assert.strictEqual(stashPickerCount, 2, 'picker should refresh after apply');
        assert.ok(info.messages.includes('Auto-stash applied.'));
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('pops a stash and removes it after Git succeeds', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo);
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      const managerItems = items as readonly ManagerQuickPickItem[];
      if (options?.placeHolder === 'Select an auto-stash') {
        return managerItems[0];
      }
      return managerItems.find((item) => item.action === 'pop');
    });
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));

        assert.strictEqual(repo.readFile('file1.txt'), 'stashed content\n');
        assert.strictEqual(repo.stashCount(), 0);
        assert.ok(info.messages.includes('Auto-stash popped.'));
        assert.ok(info.messages.includes('No auto-stashes found.'));
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('drops a stash only after modal confirmation', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo);
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      const managerItems = items as readonly ManagerQuickPickItem[];
      if (options?.placeHolder === 'Select an auto-stash') {
        return managerItems[0];
      }
      return managerItems.find((item) => item.action === 'drop');
    });
    const warnings = stubWarningMessages((_message, items) =>
      items.includes('Drop') ? 'Drop' : undefined
    );
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));

        assert.strictEqual(repo.stashCount(), 0);
        assert.ok(warnings.messages.some((message) => message.includes('Permanently drop')));
        assert.ok(info.messages.includes('Auto-stash dropped.'));
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      warnings.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('opens the selected stash patch as a diff and returns to the picker', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo);
    let stashPickerCount = 0;
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      const managerItems = items as readonly ManagerQuickPickItem[];
      if (options?.placeHolder === 'Select an auto-stash') {
        stashPickerCount++;
        return stashPickerCount === 1 ? managerItems[0] : undefined;
      }
      return managerItems.find((item) => item.action === 'diff');
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));
        await delay();

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document);
        assert.strictEqual(document.languageId, 'diff');
        assert.ok(document.getText().includes('+stashed content'));
        assert.strictEqual(stashPickerCount, 2, 'picker should reopen after viewing the diff');
        assert.deepStrictEqual(errors.messages, []);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      });
    } finally {
      errors.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('warns before applying onto a dirty worktree and proceeds when confirmed', async () => {
    const repo = createTestRepo();
    await createAutoStash(repo);
    repo.makeChange('unrelated.txt', 'keep this dirty change\n');
    let stashPickerCount = 0;
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      const managerItems = items as readonly ManagerQuickPickItem[];
      if (options?.placeHolder === 'Select an auto-stash') {
        stashPickerCount++;
        return stashPickerCount === 1 ? managerItems[0] : undefined;
      }
      return managerItems.find((item) => item.action === 'apply');
    });
    const warnings = stubWarningMessages((_message, items) =>
      items.includes('Continue') ? 'Continue' : undefined
    );
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));

        assert.ok(warnings.messages.some((message) => message.includes('uncommitted changes')));
        assert.strictEqual(repo.readFile('file1.txt'), 'stashed content\n');
        assert.strictEqual(repo.readFile('unrelated.txt'), 'keep this dirty change\n');
        assert.strictEqual(repo.stashCount(), 1);
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      warnings.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('shows an empty state when the repository has no auto-stashes', async () => {
    const repo = createTestRepo();
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('manageAutoStashes'));

        assert.deepStrictEqual(info.messages, ['No auto-stashes found.']);
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      repo.cleanup();
    }
  });
});
