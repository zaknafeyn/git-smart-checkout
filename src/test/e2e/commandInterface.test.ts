import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../../commands/checkoutToCommand/constants';
import {
  AUTO_STASH_MODE_APPLY,
  AUTO_STASH_MODE_MANUAL,
} from '../../configuration/extensionConfig';
import { EXTENSION_NAME } from '../../const';

import {
  createPullTestRepo,
  createPRTestRepo,
  createRebaseTestRepo,
  createTagTestRepo,
  createTestRepo,
  TestRepo,
} from './helpers/gitTestRepo';

type QuickPickLikeItem = vscode.QuickPickItem & {
  ref?: { name: string; fullName: string; remote?: string; isTag?: boolean };
  type?: string;
};

const commandId = (name: string) => `${EXTENSION_NAME}.${name}`;

function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function visualPause(): Promise<void> {
  const ms = Number(process.env.GSC_E2E_VISUAL_DELAY_MS ?? '0');
  if (ms > 0) {
    await delay(ms);
  }
}

async function withRepoWorkspace(repo: TestRepo, run: () => Promise<void>): Promise<void> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
  const folder = {
    uri: vscode.Uri.file(repo.repoPath),
    name: path.basename(repo.repoPath),
    index: 0,
  } as vscode.WorkspaceFolder;

  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    configurable: true,
    get: () => [folder],
  });

  try {
    await vscode.commands.executeCommand('workbench.view.scm');
    await visualPause();
    await run();
    await visualPause();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', originalDescriptor);
    } else {
      delete (vscode.workspace as any).workspaceFolders;
    }
  }
}

async function ensureExtensionActivated(): Promise<void> {
  const extension = vscode.extensions.all.find(
    (item) => item.packageJSON?.name === EXTENSION_NAME
  );

  assert.ok(extension, `Extension ${EXTENSION_NAME} should be installed in the test host.`);
  await extension.activate();
}

async function setExtensionMode(mode: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(EXTENSION_NAME)
    .update('mode', mode, vscode.ConfigurationTarget.Global);
  await delay(50);
}

function stubCreateQuickPick(
  pick: (items: readonly QuickPickLikeItem[]) => QuickPickLikeItem | undefined
): () => void {
  const original = vscode.window.createQuickPick.bind(vscode.window);

  (vscode.window as any).createQuickPick = () => {
    let accepted = false;
    let shown = false;
    let currentItems: readonly QuickPickLikeItem[] = [];
    const acceptListeners: Array<() => void> = [];
    const hideListeners: Array<() => void> = [];

    const maybeAccept = () => {
      if (!shown || accepted) {
        return;
      }

      const selected = pick(currentItems);
      if (!selected) {
        return;
      }

      accepted = true;
      quickPick.selectedItems = [selected];
      setTimeout(() => {
        acceptListeners.forEach((listener) => listener());
      }, 0);
    };

    const quickPick = {
      title: '',
      placeholder: '',
      busy: false,
      selectedItems: [] as QuickPickLikeItem[],
      buttons: [],
      get items() {
        return currentItems;
      },
      set items(items: readonly QuickPickLikeItem[]) {
        currentItems = items;
        maybeAccept();
      },
      onDidAccept(listener: () => void) {
        acceptListeners.push(listener);
        return new vscode.Disposable(() => undefined);
      },
      onDidHide(listener: () => void) {
        hideListeners.push(listener);
        return new vscode.Disposable(() => undefined);
      },
      onDidTriggerItemButton() {
        return new vscode.Disposable(() => undefined);
      },
      show() {
        shown = true;
        maybeAccept();
      },
      hide() {
        hideListeners.forEach((listener) => listener());
      },
      dispose() {
        return undefined;
      },
    };

    return quickPick;
  };

  return () => {
    (vscode.window as any).createQuickPick = original;
  };
}

function stubShowQuickPick(
  pick: (
    items: readonly (vscode.QuickPickItem | string)[],
    options: vscode.QuickPickOptions | undefined
  ) => vscode.QuickPickItem | string | undefined
): () => void {
  const original = vscode.window.showQuickPick.bind(vscode.window);

  (vscode.window as any).showQuickPick = async (
    items: readonly (vscode.QuickPickItem | string)[],
    options?: vscode.QuickPickOptions
  ) => pick(items, options);

  return () => {
    (vscode.window as any).showQuickPick = original;
  };
}

function stubInputBox(
  ...answers: Array<string | ((options: vscode.InputBoxOptions) => string | undefined)>
): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  const queue = [...answers];

  (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
    const answer = queue.shift();
    return typeof answer === 'function' ? answer(options) : answer;
  };

  return () => {
    (vscode.window as any).showInputBox = original;
  };
}

function stubInformationMessages(
  pick: (message: string, items: readonly string[]) => string | undefined
): { messages: string[]; items: string[][]; restore: () => void } {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  const messages: string[] = [];
  const shownItems: string[][] = [];

  (vscode.window as any).showInformationMessage = async (message: string, ...args: any[]) => {
    messages.push(message);
    const items = typeof args[0] === 'object' && typeof args[0] !== 'string'
      ? args.slice(1)
      : args;
    shownItems.push(items);
    return pick(message, items);
  };

  return {
    messages,
    items: shownItems,
    restore() {
      (vscode.window as any).showInformationMessage = original;
    },
  };
}

function stubWarningMessages(
  pick: (message: string, items: readonly string[]) => string | undefined
): { messages: string[]; items: string[][]; restore: () => void } {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  const messages: string[] = [];
  const shownItems: string[][] = [];

  (vscode.window as any).showWarningMessage = async (message: string, ...args: any[]) => {
    messages.push(message);
    const items = typeof args[0] === 'object' && typeof args[0] !== 'string'
      ? args.slice(1)
      : args;
    shownItems.push(items);
    return pick(message, items);
  };

  return {
    messages,
    items: shownItems,
    restore() {
      (vscode.window as any).showWarningMessage = original;
    },
  };
}

function stubErrorMessages(): { messages: string[]; restore: () => void } {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  const messages: string[] = [];

  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };

  return {
    messages,
    restore() {
      (vscode.window as any).showErrorMessage = original;
    },
  };
}

function pickBranch(branchName: string): (items: readonly QuickPickLikeItem[]) => QuickPickLikeItem | undefined {
  return (items) =>
    items.find((item) => item.ref?.name === branchName && !item.ref.remote && !item.ref.isTag);
}

async function executeCheckoutTo(
  repo: TestRepo,
  branchName: string,
  stashMode: string
): Promise<string[]> {
  const restoreQuickPick = stubCreateQuickPick(pickBranch(branchName));
  const restoreModePick = stubShowQuickPick((items, options) => {
    assert.strictEqual(options?.placeHolder, 'Select auto stash mode');
    return items.find((item) => typeof item !== 'string' && item.label === stashMode) as vscode.QuickPickItem;
  });
  const errors = stubErrorMessages();

  try {
    await vscode.commands.executeCommand(commandId('checkoutTo'));
    await delay();
    await visualPause();
    return errors.messages;
  } finally {
    errors.restore();
    restoreModePick();
    restoreQuickPick();
  }
}

function assertHeadContains(repo: TestRepo, target: string): void {
  assert.doesNotThrow(
    () => repo.exec(`git merge-base --is-ancestor ${target} HEAD`),
    `HEAD should contain ${target}`
  );
}

function getDefaultWorktreePath(repo: TestRepo, branchName: string): string {
  return path.join(
    path.dirname(repo.repoPath),
    `${path.basename(repo.repoPath)}-${branchName.replace(/[\\/]+/g, '-')}`
  );
}

async function cleanupWorktree(repo: TestRepo, worktreePath: string): Promise<void> {
  try {
    await repo.git.worktreeRemove(worktreePath);
  } catch {
    // The worktree may not have been created if the command failed before that point.
  }

  fs.rmSync(worktreePath, { recursive: true, force: true });
}

function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

function stashMessages(repo: TestRepo): string[] {
  return repo.exec('git stash list --format="%gs"')
    .trim()
    .split('\n')
    .filter((message) => message.trim() !== '');
}

describe('VS Code command interface', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  beforeEach(async () => {
    await setExtensionMode(AUTO_STASH_MODE_MANUAL);
  });

  describe('checkoutTo', () => {
    const cases = [
      {
        mode: AUTO_STASH_CURRENT_BRANCH,
        expectedDirty: false,
        expectedStashes: 1,
      },
      {
        mode: AUTO_STASH_AND_POP_IN_NEW_BRANCH,
        expectedDirty: true,
        expectedStashes: 0,
      },
      {
        mode: AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
        expectedDirty: true,
        expectedStashes: 1,
      },
      {
        mode: AUTO_STASH_IGNORE,
        expectedDirty: true,
        expectedStashes: 0,
      },
    ];

    for (const testCase of cases) {
      it(`runs ${testCase.mode} through the contributed command`, async () => {
        const repo = createTestRepo();
        try {
          await withRepoWorkspace(repo, async () => {
            repo.makeChange('file1.txt', `${testCase.mode}\n`);

            const errors = await executeCheckoutTo(repo, repo.featureBranch, testCase.mode);

            assert.deepStrictEqual(errors, []);
            assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
            assert.strictEqual(await repo.git.isWorkdirHasChanges(), testCase.expectedDirty);
            assert.strictEqual(repo.stashCount(), testCase.expectedStashes);
          });
        } finally {
          repo.cleanup();
        }
      });
    }

    it('creates a new branch from the command picker action', async () => {
      const repo = createTestRepo();
      const restoreQuickPick = stubCreateQuickPick((items) =>
        items.find((item) => item.type === 'action' && item.label.includes('Create new branch...'))
      );
      const restoreInput = stubInputBox('command-created-branch');
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.getCurrentBranch(), 'command-created-branch');
        });
      } finally {
        errors.restore();
        restoreInput();
        restoreQuickPick();
        repo.cleanup();
      }
    });

    it('creates a new branch from a selected base and restores dirty changes', async () => {
      const repo = createTestRepo();
      const restoreQuickPick = stubCreateQuickPick((items) =>
        items.find((item) => item.type === 'action' && item.label.includes('Create new branch from...'))
      );
      const restoreShowQuickPick = stubShowQuickPick((items, options) => {
        assert.strictEqual(options?.placeHolder, 'Select a branch to base the new branch on');
        return items.find((item) => typeof item === 'string' && item.includes(repo.featureBranch));
      });
      const restoreInput = stubInputBox('command-created-from-feature');
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'command dirty change\n');

          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.getCurrentBranch(), 'command-created-from-feature');
          assert.strictEqual(repo.fileExists('feature.txt'), true);
          assert.strictEqual(repo.readFile('file1.txt'), 'command dirty change\n');
          assert.strictEqual(repo.stashCount(), 0);
        });
      } finally {
        errors.restore();
        restoreInput();
        restoreShowQuickPick();
        restoreQuickPick();
        repo.cleanup();
      }
    });
  });

  describe('moveToNewWorktree', () => {
    it('excludes the current branch and branches checked out in another worktree', async () => {
      const repo = createTestRepo();
      const featureWorktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const otherBranch = 'other';
      const otherWorktreePath = getDefaultWorktreePath(repo, otherBranch);
      let inspectedBranchPicker = false;

      repo.exec(`git branch ${otherBranch}`);
      repo.exec(`git worktree add "${featureWorktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a target branch for the new worktree') {
          inspectedBranchPicker = true;
          const refs = items
            .filter((item): item is QuickPickLikeItem => typeof item !== 'string' && Boolean((item as QuickPickLikeItem).ref))
            .map((item) => item.ref?.name);

          assert.ok(!refs.includes(repo.mainBranch), 'current branch should be hidden');
          assert.ok(!refs.includes(repo.featureBranch), 'checked-out worktree branch should be hidden');

          return items.find((item) =>
            typeof item !== 'string' &&
            (item as QuickPickLikeItem).ref?.name === otherBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const restoreInput = stubInputBox((options) => {
        assert.strictEqual(options.value, `${path.basename(repo.repoPath)}-${otherBranch}`);
        return options.value;
      });
      const info = stubInformationMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Add to Workspace',
          'Open Folder',
          'Open in New Window',
        ]);
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

          assert.strictEqual(inspectedBranchPicker, true);
          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(otherWorktreePath), true);
          assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
        });
      } finally {
        errors.restore();
        info.restore();
        restoreInput();
        restoreQuickPick();
        await cleanupWorktree(repo, otherWorktreePath);
        await cleanupWorktree(repo, featureWorktreePath);
        repo.cleanup();
      }
    });

    it('creates a local tracking worktree from a remote-only branch', async () => {
      const repo = createPRTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a target branch for the new worktree') {
          return items.find((item) =>
            typeof item !== 'string' &&
            (item as QuickPickLikeItem).ref?.name === repo.prBranch &&
            (item as QuickPickLikeItem).ref?.remote === 'origin'
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const restoreInput = stubInputBox((options) => options.value);
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(execIn(worktreePath, 'git branch --show-current').trim(), repo.prBranch);
          assert.strictEqual(
            execIn(worktreePath, `git rev-parse --abbrev-ref ${repo.prBranch}@{upstream}`).trim(),
            `origin/${repo.prBranch}`
          );
        });
      } finally {
        errors.restore();
        info.restore();
        restoreInput();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('suggests a sanitized directory name for branch names with slashes', async () => {
      const repo = createTestRepo();
      const branchName = 'topic/nested-name';
      const worktreePath = getDefaultWorktreePath(repo, branchName);
      repo.exec(`git branch ${branchName}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a target branch for the new worktree') {
          return items.find((item) =>
            typeof item !== 'string' &&
            (item as QuickPickLikeItem).ref?.name === branchName
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const restoreInput = stubInputBox((options) => {
        assert.strictEqual(options.value, `${path.basename(repo.repoPath)}-topic-nested-name`);
        return options.value;
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(worktreePath), true);
        });
      } finally {
        errors.restore();
        info.restore();
        restoreInput();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('moves dirty changes into the new worktree with stash pop mode', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a target branch for the new worktree') {
          return items.find((item) =>
            typeof item !== 'string' &&
            (item as QuickPickLikeItem).ref?.name === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        if (options?.placeHolder === 'Select auto stash mode') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === AUTO_STASH_AND_POP_IN_NEW_BRANCH
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const restoreInput = stubInputBox((options) => options.value);
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'worktree dirty content\n');

          await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim().length > 0, true);
          assert.strictEqual(fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'), 'worktree dirty content\n');
          assert.strictEqual(repo.stashCount(), 0);
        });
      } finally {
        errors.restore();
        info.restore();
        restoreInput();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('leaves dirty changes in the source repo with no auto stash mode', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a target branch for the new worktree') {
          return items.find((item) =>
            typeof item !== 'string' &&
            (item as QuickPickLikeItem).ref?.name === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        if (options?.placeHolder === 'Select auto stash mode') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === AUTO_STASH_IGNORE
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const restoreInput = stubInputBox((options) => options.value);
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'source dirty content\n');

          await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), '');
          assert.strictEqual(repo.stashCount(), 0);
        });
      } finally {
        errors.restore();
        info.restore();
        restoreInput();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });
  });

  describe('removeWorktree', () => {
    it('excludes the main worktree and lists linked worktrees', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      let inspectedPicker = false;

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to remove') {
          inspectedPicker = true;
          const labels = items
            .filter((item): item is QuickPickLikeItem => typeof item !== 'string')
            .map((item) => item.label);

          assert.ok(!labels.includes(repo.mainBranch), 'main worktree should be hidden');
          assert.ok(labels.includes(repo.featureBranch), 'linked worktree should be listed');
        }

        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('removeWorktree'));

          assert.strictEqual(inspectedPicker, true);
          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(worktreePath), true);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('removes a clean linked worktree after confirmation', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === path.basename(repo.repoPath)
          ) as vscode.QuickPickItem;
        }

        if (options?.placeHolder === 'Select a worktree to remove') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, items) => {
        assert.deepStrictEqual(items, ['Remove Worktree', 'Cancel']);
        return 'Remove Worktree';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('removeWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(warnings.messages.length, 1);
          assert.strictEqual(fs.existsSync(worktreePath), false);
        });
      } finally {
        errors.restore();
        info.restore();
        warnings.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('stashes dirty changes before removing the worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);
      fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'dirty before remove\n');
      fs.writeFileSync(path.join(worktreePath, 'notes.txt'), 'untracked before remove\n');

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to remove') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Stash Changes and Remove',
          'Reset Changes and Remove',
          'Cancel',
        ]);
        return 'Stash Changes and Remove';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('removeWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(worktreePath), false);
          assert.strictEqual(repo.stashCount(), 1);
          assert.ok(
            stashMessages(repo).some((message) => message.includes(`auto-stash-${repo.featureBranch}`)),
            'stash should use the current-branch auto-stash name'
          );
        });
      } finally {
        errors.restore();
        info.restore();
        warnings.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('resets dirty changes before removing the worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);
      fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'dirty before reset remove\n');
      fs.writeFileSync(path.join(worktreePath, 'notes.txt'), 'untracked before reset remove\n');

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to remove') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Stash Changes and Remove',
          'Reset Changes and Remove',
          'Cancel',
        ]);
        return 'Reset Changes and Remove';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('removeWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(worktreePath), false);
          assert.strictEqual(repo.stashCount(), 0);
        });
      } finally {
        errors.restore();
        info.restore();
        warnings.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('cancels dirty worktree removal without changing files', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);
      fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'dirty but kept\n');

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to remove') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, _items) => 'Cancel');
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('removeWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(fs.existsSync(worktreePath), true);
          assert.strictEqual(fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'), 'dirty but kept\n');
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim().length > 0, true);
        });
      } finally {
        errors.restore();
        warnings.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('removes matching open workspace folders after deleting the worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const originalFolders = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
      const originalUpdateWorkspaceFolders = vscode.workspace.updateWorkspaceFolders.bind(vscode.workspace);
      let folders = [
        {
          uri: vscode.Uri.file(repo.repoPath),
          name: path.basename(repo.repoPath),
          index: 0,
        },
        {
          uri: vscode.Uri.file(worktreePath),
          name: path.basename(worktreePath),
          index: 1,
        },
      ] as vscode.WorkspaceFolder[];

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        configurable: true,
        get: () => folders,
      });

      (vscode.workspace as any).updateWorkspaceFolders = (start: number, deleteCount: number) => {
        folders.splice(start, deleteCount);
        folders = folders.map((folder, index) => ({ ...folder, index }));
        return true;
      };

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === path.basename(repo.repoPath)
          ) as vscode.QuickPickItem;
        }

        if (options?.placeHolder === 'Select a worktree to remove') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === repo.featureBranch
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, _items) => 'Remove Worktree');
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await vscode.commands.executeCommand(commandId('removeWorktree'));

        assert.deepStrictEqual(errors.messages, []);
        assert.strictEqual(fs.existsSync(worktreePath), false);
        assert.deepStrictEqual(folders.map((folder) => folder.uri.fsPath), [repo.repoPath]);
      } finally {
        errors.restore();
        info.restore();
        warnings.restore();
        restoreQuickPick();
        (vscode.workspace as any).updateWorkspaceFolders = originalUpdateWorkspaceFolders;
        if (originalFolders) {
          Object.defineProperty(vscode.workspace, 'workspaceFolders', originalFolders);
        } else {
          delete (vscode.workspace as any).workspaceFolders;
        }
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });
  });

  it('checkoutPrevious switches through the contributed command', async () => {
    const repo = createTestRepo();
    const restoreModePick = stubShowQuickPick((items, options) => {
      assert.strictEqual(options?.placeHolder, 'Select auto stash mode');
      return items.find((item) => typeof item !== 'string' && item.label === AUTO_STASH_CURRENT_BRANCH) as vscode.QuickPickItem;
    });
    const info = stubInformationMessages((_message, items) => items[0]);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        repo.exec(`git checkout ${repo.featureBranch}`);

        await vscode.commands.executeCommand(commandId('checkoutPrevious'));

        assert.deepStrictEqual(errors.messages, []);
        assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
        assert.ok(info.messages.some((message) => message.includes('Switched to previous branch')));
      });
    } finally {
      errors.restore();
      info.restore();
      restoreModePick();
      repo.cleanup();
    }
  });

  it('pullWithStash pulls the tracked branch and restores local changes', async () => {
    const repo = createPullTestRepo();

    try {
      await withRepoWorkspace(repo, async () => {
        repo.makeChange('file1.txt', 'local dirty content\n');

        await vscode.commands.executeCommand(commandId('pullWithStash'));

        assert.strictEqual(repo.fileExists('remote.txt'), true);
        assert.strictEqual(repo.readFile('file1.txt'), 'local dirty content\n');
        assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
        assert.strictEqual(repo.stashCount(), 0);
      });
    } finally {
      repo.cleanup();
    }
  });

  it('pullRebaseWithStash rebases local commits and restores local changes', async () => {
    const repo = createPullTestRepo();

    try {
      await withRepoWorkspace(repo, async () => {
        repo.makeChange('local.txt', 'local committed content\n');
        repo.exec('git add local.txt');
        repo.exec('git commit -m "feat: local change"');
        repo.makeChange('file1.txt', 'local dirty content\n');
        repo.makeChange('notes.txt', 'untracked notes\n');

        await vscode.commands.executeCommand(commandId('pullRebaseWithStash'));

        const latestSubjects = repo.exec('git log --format=%s -2').trim().split('\n');

        assert.deepStrictEqual(latestSubjects, ['feat: local change', 'feat: remote change']);
        assert.strictEqual(repo.fileExists('remote.txt'), true);
        assert.strictEqual(repo.fileExists('local.txt'), true);
        assert.strictEqual(repo.readFile('file1.txt'), 'local dirty content\n');
        assert.strictEqual(repo.readFile('notes.txt'), 'untracked notes\n');
        assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
        assert.strictEqual(repo.stashCount(), 0);
      });
    } finally {
      repo.cleanup();
    }
  });

  it('rebaseWithStash selects mode and target through VS Code prompts', async () => {
    const repo = createRebaseTestRepo();
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select auto stash mode for rebase') {
        return items.find((item) => typeof item !== 'string' && item.label === AUTO_STASH_CURRENT_BRANCH) as vscode.QuickPickItem;
      }

      assert.strictEqual(options?.placeHolder, 'Select a branch or tag to rebase onto');
      return items.find((item) =>
        typeof item !== 'string' &&
        (item as QuickPickLikeItem).ref?.name === repo.mainBranch &&
        !(item as QuickPickLikeItem).ref?.remote
      ) as vscode.QuickPickItem;
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        repo.makeChange('file1.txt', 'tracked command rebase change\n');

        await vscode.commands.executeCommand(commandId('rebaseWithStash'));

        assert.deepStrictEqual(errors.messages, []);
        assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
        assertHeadContains(repo, repo.mainBranch);
        assert.strictEqual(repo.readFile('file1.txt'), 'tracked command rebase change\n');
        assert.strictEqual(repo.stashCount(), 0);
      });
    } finally {
      errors.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('createTagFromTemplate creates and pushes a tag through command prompts', async () => {
    const repo = createTagTestRepo();
    const restoreInput = stubInputBox('command-v1.0.0');
    const info = stubInformationMessages((message, items) => {
      if (message.includes('Create Git tag')) {
        return 'Create';
      }
      if (message.includes('Push tag')) {
        return 'Push';
      }
      return items[0];
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('createTagFromTemplate'));

        assert.deepStrictEqual(errors.messages, []);
        assert.strictEqual(await repo.git.tagExists('command-v1.0.0'), true);
        assert.strictEqual(repo.remoteHasTag('command-v1.0.0'), true);
        assert.ok(
          info.items.some((items) => items.includes('Copy Tag')),
          'created tag notification should offer Copy Tag'
        );
        assert.strictEqual(await vscode.env.clipboard.readText(), 'command-v1.0.0');
      });
    } finally {
      errors.restore();
      info.restore();
      restoreInput();
      repo.cleanup();
    }
  });

  it('switchMode updates the extension mode from the VS Code command', async () => {
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    const originalGlobalMode = config.inspect<string>('mode')?.globalValue;
    const restoreQuickPick = stubShowQuickPick((items, options) => {
      assert.strictEqual(options?.placeHolder, 'Choose the operating mode for your extension');
      return items.find((item) =>
        typeof item !== 'string' &&
        item.label.includes('Auto stash and apply in new branch')
      ) as vscode.QuickPickItem;
    });

    try {
      await vscode.commands.executeCommand(commandId('switchMode'));

      assert.strictEqual(
        vscode.workspace.getConfiguration(EXTENSION_NAME).get('mode'),
        AUTO_STASH_MODE_APPLY
      );
    } finally {
      restoreQuickPick();
      await setExtensionMode(originalGlobalMode);
    }
  });
});
