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
  COPY_AND_OPEN_ISSUE_ACTION,
  ISSUE_URL,
} from '../../utils/errorIssueNotification';

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
  worktree?: { path: string };
  hasChanges?: boolean;
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
  pick: (
    items: readonly QuickPickLikeItem[],
    quickPick: { title: string; placeholder: string }
  ) => QuickPickLikeItem | undefined
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

      const selected = pick(currentItems, quickPick);
      if (!selected) {
        accepted = true;
        setTimeout(() => {
          hideListeners.forEach((listener) => listener());
        }, 0);
        return;
      }

      accepted = true;
      quickPick.selectedItems = [selected];
      quickPick.activeItems = [selected];
      setTimeout(() => {
        acceptListeners.forEach((listener) => listener());
      }, 0);
    };

    const quickPick = {
      title: '',
      placeholder: '',
      busy: false,
      selectedItems: [] as QuickPickLikeItem[],
      activeItems: [] as QuickPickLikeItem[],
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
      onDidChangeActive() {
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
  return (items) => {
    const item = items.find((candidate) =>
      candidate.ref?.name === branchName &&
      !candidate.ref.remote &&
      !candidate.ref.isTag
    );
    assert.ok(item?.detail, 'selected branch should include enriched details before display');
    return item;
  };
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

function normalizeTestPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isSameTestPath(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }

  return normalizeTestPath(left) === normalizeTestPath(right);
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

  it('contributes the PR review worktree removal command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(commandId('removePRReviewInWorktree')));
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

    it('marks branches already checked out in another worktree with a folder icon', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      let inspectedBranchPicker = false;

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a branch to checkout');
        inspectedBranchPicker = true;
        const featureItem = items.find((item) =>
          item.ref?.name === repo.featureBranch &&
          !item.ref.remote &&
          !item.ref.isTag
        );

        assert.ok(featureItem, 'feature branch should be listed');
        assert.ok(
          featureItem.label.startsWith('$(folder) '),
          'checked-out worktree branch should be marked with a folder icon'
        );

        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.strictEqual(inspectedBranchPicker, true);
          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('creates a new branch from the command picker action', async () => {
      const repo = createTestRepo();
      const newBranchName = 'command-created-branch';
      const startingHead = repo.exec('git rev-parse HEAD').trim();
      let inspectedCommandPicker = false;
      let inspectedInput = false;
      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a branch to checkout');
        inspectedCommandPicker = true;
        const createAction = items.find((item) =>
          item.type === 'action' && item.label.includes('Create new branch...')
        );

        assert.ok(createAction, 'create-new-branch action should be listed');
        return createAction;
      });
      const restoreInput = stubInputBox((options) => {
        inspectedInput = true;
        assert.strictEqual(options.placeHolder, 'Branch name');
        assert.strictEqual(options.prompt, 'Please provide a new branch name');
        return newBranchName;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.strictEqual(inspectedCommandPicker, true);
          assert.strictEqual(inspectedInput, true);
          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.getCurrentBranch(), newBranchName);
          assert.strictEqual(repo.exec(`git rev-parse ${newBranchName}`).trim(), startingHead);
          assertHeadContains(repo, repo.mainBranch);
          assert.strictEqual(repo.fileExists('feature.txt'), false);
          assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
          assert.strictEqual(repo.stashCount(), 0);
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
      const newBranchName = 'command-created-from-feature';
      const featureHead = repo.exec(`git rev-parse ${repo.featureBranch}`).trim();
      let inspectedCommandPicker = false;
      let inspectedBasePicker = false;
      let inspectedInput = false;
      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        // The command picker and the base-branch picker both use createQuickPick;
        // distinguish them by placeholder.
        if (quickPick.placeholder === 'Select a branch to checkout') {
          inspectedCommandPicker = true;
          const createFromAction = items.find((item) =>
            item.type === 'action' && item.label.includes('Create new branch from...')
          );

          assert.ok(createFromAction, 'create-new-branch-from action should be listed');
          return createFromAction;
        }

        inspectedBasePicker = true;
        assert.strictEqual(quickPick.placeholder, 'Select a branch to base the new branch on');
        assert.ok(
          items.some((item) => item.ref?.name === repo.mainBranch),
          'base picker should include the main branch'
        );
        const featureItem = items.find((item) => item.ref?.name === repo.featureBranch);

        assert.ok(featureItem, 'base picker should include the feature branch');
        return featureItem;
      });
      const restoreInput = stubInputBox((options) => {
        inspectedInput = true;
        assert.strictEqual(options.placeHolder, 'Branch name');
        assert.strictEqual(options.prompt, 'Please provide a new branch name');
        return newBranchName;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'command dirty change\n');

          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();

          assert.strictEqual(inspectedCommandPicker, true);
          assert.strictEqual(inspectedBasePicker, true);
          assert.strictEqual(inspectedInput, true);
          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(await repo.git.getCurrentBranch(), newBranchName);
          assert.strictEqual(repo.exec(`git rev-parse ${newBranchName}`).trim(), featureHead);
          assertHeadContains(repo, repo.featureBranch);
          assert.strictEqual(repo.fileExists('feature.txt'), true);
          assert.strictEqual(repo.readFile('file1.txt'), 'command dirty change\n');
          assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
          assert.strictEqual(repo.stashCount(), 0);
        });
      } finally {
        errors.restore();
        restoreInput();
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

      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
        inspectedBranchPicker = true;
        const refs = items
          .filter((item) => Boolean(item.ref))
          .map((item) => item.ref?.name);

        assert.ok(!refs.includes(repo.mainBranch), 'current branch should be hidden');
        assert.ok(!refs.includes(repo.featureBranch), 'checked-out worktree branch should be hidden');

        return items.find((item) => item.ref?.name === otherBranch);
      });
      const restoreInput = stubInputBox((options) => {
        assert.strictEqual(options.value, `${path.basename(repo.repoPath)}-${otherBranch}`);
        return options.value;
      });
      const info = stubInformationMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Add to Workspace',
          'Open in Current Window',
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
      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
        return items.find((item) =>
          item.ref?.name === repo.prBranch &&
          item.ref?.remote === 'origin'
        );
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

      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
        return items.find((item) => item.ref?.name === branchName);
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
      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
        return items.find((item) => item.ref?.name === repo.featureBranch);
      });
      const restoreModePick = stubShowQuickPick((items, options) => {
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
        restoreModePick();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('leaves dirty changes in the source repo with no auto stash mode', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
        assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
        return items.find((item) => item.ref?.name === repo.featureBranch);
      });
      const restoreModePick = stubShowQuickPick((items, options) => {
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
        restoreModePick();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });
  });

  describe('copyChangesToWorktree', () => {
    it('shows a notification when there are no other worktrees', async () => {
      const repo = createTestRepo();
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.ok(
            info.messages.includes('No other Git worktrees available to copy changes to.')
          );
        });
      } finally {
        errors.restore();
        info.restore();
        repo.cleanup();
      }
    });

    it('excludes the current worktree and marks clean and dirty targets', async () => {
      const repo = createTestRepo();
      const cleanWorktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const dirtyBranch = 'dirty-target';
      const dirtyWorktreePath = getDefaultWorktreePath(repo, dirtyBranch);
      let inspectedPicker = false;

      repo.exec(`git branch ${dirtyBranch}`);
      repo.exec(`git worktree add "${cleanWorktreePath}" ${repo.featureBranch}`);
      repo.exec(`git worktree add "${dirtyWorktreePath}" ${dirtyBranch}`);
      fs.writeFileSync(path.join(dirtyWorktreePath, 'file1.txt'), 'dirty target\n');

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          inspectedPicker = true;
          const worktreeItems = items.filter(
            (item): item is QuickPickLikeItem => typeof item !== 'string'
          );

          assert.ok(!worktreeItems.some((item) => isSameTestPath(item.worktree?.path, repo.repoPath)));

          const cleanItem = worktreeItems.find((item) => isSameTestPath(item.worktree?.path, cleanWorktreePath));
          const dirtyItem = worktreeItems.find((item) => isSameTestPath(item.worktree?.path, dirtyWorktreePath));

          assert.ok(cleanItem?.description?.includes('$(check) Clean'));
          assert.strictEqual(cleanItem?.hasChanges, false);
          assert.ok(dirtyItem?.description?.includes('$(warning) Has changes'));
          assert.strictEqual(dirtyItem?.hasChanges, true);
        }

        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

          assert.strictEqual(inspectedPicker, true);
          assert.deepStrictEqual(errors.messages, []);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, cleanWorktreePath);
        await cleanupWorktree(repo, dirtyWorktreePath);
        repo.cleanup();
      }
    });

    it('copies only staged changes and keeps them staged in the target worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const info = stubInformationMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Add to Workspace',
          'Open in Current Window',
          'Open in New Window',
        ]);
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'staged source content\n');
          repo.exec('git add file1.txt');
          repo.makeChange('notes.txt', 'source untracked notes\n');

          await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(execIn(worktreePath, 'git diff --cached --name-only').trim(), 'file1.txt');
          assert.strictEqual(execIn(worktreePath, 'git diff --name-only').trim(), '');
          assert.strictEqual(fs.existsSync(path.join(worktreePath, 'notes.txt')), false);
          assert.strictEqual(repo.exec('git diff --cached --name-only').trim(), 'file1.txt');
          assert.strictEqual(repo.fileExists('notes.txt'), true);
        });
      } finally {
        errors.restore();
        info.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('shows completion actions when staged copy has nothing to copy', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const info = stubInformationMessages((message, items) => {
        assert.ok(message.includes('No changes to copy.'));
        assert.deepStrictEqual(items, [
          'Add to Workspace',
          'Open in Current Window',
          'Open in New Window',
        ]);
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), '');
        });
      } finally {
        errors.restore();
        info.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('does not offer to add a target worktree that is already in the workspace', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);
      const originalFolders = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const folders = [
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

      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        configurable: true,
        get: () => folders,
      });

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Choose a repository') {
          return items.find((item) =>
            typeof item !== 'string' &&
            item.label === path.basename(repo.repoPath)
          ) as vscode.QuickPickItem;
        }

        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const info = stubInformationMessages((_message, items) => {
        assert.deepStrictEqual(items, [
          'Open in Current Window',
          'Open in New Window',
        ]);
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

        assert.deepStrictEqual(errors.messages, []);
      } finally {
        errors.restore();
        info.restore();
        restoreQuickPick();
        if (originalFolders) {
          Object.defineProperty(vscode.workspace, 'workspaceFolders', originalFolders);
        } else {
          delete (vscode.workspace as any).workspaceFolders;
        }
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('copies staged, unstaged, and untracked WIP while preserving source changes', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'staged source content\n');
          repo.exec('git add file1.txt');
          repo.makeChange('file1.txt', 'unstaged source content\n');
          repo.makeChange('notes.txt', 'source untracked notes\n');

          await vscode.commands.executeCommand(commandId('copyWipChangesToWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(execIn(worktreePath, 'git show :file1.txt'), 'staged source content\n');
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'),
            'unstaged source content\n'
          );
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'notes.txt'), 'utf-8'),
            'source untracked notes\n'
          );
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), 'MM file1.txt\n?? notes.txt');
          assert.strictEqual(repo.exec('git show :file1.txt'), 'staged source content\n');
          assert.strictEqual(repo.readFile('file1.txt'), 'unstaged source content\n');
          assert.strictEqual(repo.readFile('notes.txt'), 'source untracked notes\n');
        });
      } finally {
        errors.restore();
        info.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('blocks copying into a dirty target worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);
      fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'target dirty content\n');

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy changes to') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((message, items) => {
        assert.ok(message.includes('has local changes'));
        assert.deepStrictEqual(items, ['OK']);
        return 'OK';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'source staged content\n');
          repo.exec('git add file1.txt');

          await vscode.commands.executeCommand(commandId('copyStagedChangesToWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(warnings.messages.length, 1);
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'),
            'target dirty content\n'
          );
          assert.strictEqual(repo.exec('git diff --cached --name-only').trim(), 'file1.txt');
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
  });

  describe('copyChangesFromWorktree', () => {
    it('copies staged, unstaged, and untracked WIP from a selected worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy WIP changes from') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'staged source content\n');
          execIn(worktreePath, 'git add file1.txt');
          fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'unstaged source content\n');
          fs.writeFileSync(path.join(worktreePath, 'notes.txt'), 'source untracked notes\n');

          await vscode.commands.executeCommand(commandId('copyWipChangesFromWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(repo.exec('git show :file1.txt'), 'staged source content\n');
          assert.strictEqual(repo.readFile('file1.txt'), 'unstaged source content\n');
          assert.strictEqual(repo.readFile('notes.txt'), 'source untracked notes\n');
          assert.strictEqual(repo.exec('git status --porcelain').trim(), 'MM file1.txt\n?? notes.txt');
          assert.strictEqual(execIn(worktreePath, 'git show :file1.txt'), 'staged source content\n');
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'),
            'unstaged source content\n'
          );
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'notes.txt'), 'utf-8'),
            'source untracked notes\n'
          );
        });
      } finally {
        errors.restore();
        info.restore();
        restoreQuickPick();
        await cleanupWorktree(repo, worktreePath);
        repo.cleanup();
      }
    });

    it('moves WIP from a selected worktree and cleans the source worktree', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy WIP changes from') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, items) => {
        assert.deepStrictEqual(items, ['Move WIP', 'Cancel']);
        return 'Move WIP';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'staged source content\n');
          execIn(worktreePath, 'git add file1.txt');
          fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'unstaged source content\n');
          fs.writeFileSync(path.join(worktreePath, 'notes.txt'), 'source untracked notes\n');

          await vscode.commands.executeCommand(commandId('moveWipChangesFromWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(repo.exec('git show :file1.txt'), 'staged source content\n');
          assert.strictEqual(repo.readFile('file1.txt'), 'unstaged source content\n');
          assert.strictEqual(repo.readFile('notes.txt'), 'source untracked notes\n');
          assert.strictEqual(repo.exec('git status --porcelain').trim(), 'MM file1.txt\n?? notes.txt');
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), '');
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'),
            'initial content\n'
          );
          assert.strictEqual(fs.existsSync(path.join(worktreePath, 'notes.txt')), false);
          assert.strictEqual(warnings.messages.length, 1);
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

    it('cancels copying from a worktree when the current worktree is dirty', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy WIP changes from') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((message, items) => {
        assert.ok(message.includes('current worktree has local changes'));
        assert.deepStrictEqual(items, ['Apply Anyway', 'Cancel']);
        return 'Cancel';
      });
      const info = stubInformationMessages((_message, _items) => undefined);
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          repo.makeChange('file1.txt', 'current dirty content\n');
          fs.writeFileSync(path.join(worktreePath, 'feature.txt'), 'source dirty content\n');

          await vscode.commands.executeCommand(commandId('copyWipChangesFromWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(warnings.messages.length, 1);
          assert.strictEqual(repo.readFile('file1.txt'), 'current dirty content\n');
          assert.strictEqual(repo.exec('git status --porcelain').trim(), 'M file1.txt');
          assert.strictEqual(
            fs.readFileSync(path.join(worktreePath, 'feature.txt'), 'utf-8'),
            'source dirty content\n'
          );
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), 'M feature.txt');
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

    it('does not reset a source worktree when move has no WIP to copy', async () => {
      const repo = createTestRepo();
      const worktreePath = getDefaultWorktreePath(repo, repo.featureBranch);

      repo.exec(`git worktree add "${worktreePath}" ${repo.featureBranch}`);

      const restoreQuickPick = stubShowQuickPick((items, options) => {
        if (options?.placeHolder === 'Select a worktree to copy WIP changes from') {
          return items.find((item) =>
            typeof item !== 'string' &&
            isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
          ) as vscode.QuickPickItem;
        }

        return undefined;
      });
      const warnings = stubWarningMessages((_message, _items) => undefined);
      const info = stubInformationMessages((message, items) => {
        assert.ok(message.includes('No WIP changes to move.'));
        assert.deepStrictEqual(items, ['OK']);
        return 'OK';
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('moveWipChangesFromWorktree'));

          assert.deepStrictEqual(errors.messages, []);
          assert.strictEqual(warnings.messages.length, 0);
          assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), '');
          assert.strictEqual(fs.existsSync(worktreePath), true);
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
    const restoreModePick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select auto stash mode for rebase') {
        return items.find((item) => typeof item !== 'string' && item.label === AUTO_STASH_CURRENT_BRANCH) as vscode.QuickPickItem;
      }

      return undefined;
    });
    const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
      assert.strictEqual(quickPick.placeholder, 'Select a branch or tag to rebase onto');
      return items.find((item) =>
        item.ref?.name === repo.mainBranch &&
        !item.ref?.remote
      );
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
      restoreModePick();
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('createTagFromTemplate creates and pushes a tag through command prompts', async () => {
    const repo = createTagTestRepo();
    const restoreInput = stubInputBox((options) => {
      assert.strictEqual(options.value, '', 'manual entry should open an empty input box');
      return 'command-v1.0.0';
    });
    const info = stubInformationMessages((message, items) => {
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

  it('createTagFromTemplate prefills the resolved template and lets the user edit it', async () => {
    const repo = createTagTestRepo();
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    const originalTemplate = config.inspect<string>('tagTemplate')?.globalValue;
    await config.update('tagTemplate', 'release-candidate', vscode.ConfigurationTarget.Global);
    await delay(50);

    let prefilledValue: string | undefined;
    const restoreInput = stubInputBox((options) => {
      prefilledValue = options.value;
      return 'release-candidate-edited';
    });
    const info = stubInformationMessages((message, items) => {
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
        assert.strictEqual(
          prefilledValue,
          'release-candidate',
          'input box should prefill the resolved template, mirroring branch creation'
        );
        assert.strictEqual(await repo.git.tagExists('release-candidate-edited'), true);
        assert.strictEqual(
          await repo.git.tagExists('release-candidate'),
          false,
          'the edited name should be used instead of the prefilled template'
        );
      });
    } finally {
      errors.restore();
      info.restore();
      restoreInput();
      await config.update('tagTemplate', originalTemplate, vscode.ConfigurationTarget.Global);
      await delay(50);
      repo.cleanup();
    }
  });

  it('showNotification error action copies the error and opens a GitHub issue', async () => {
    const message = 'Failed to copy commits to clipboard: Error: command interface test';
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    const originalOpenExternal = vscode.env.openExternal.bind(vscode.env);
    const messages: string[] = [];
    const items: string[][] = [];
    let openedUri: vscode.Uri | undefined;

    (vscode.window as any).showErrorMessage = async (shownMessage: string, ...shownItems: string[]) => {
      messages.push(shownMessage);
      items.push(shownItems);
      return COPY_AND_OPEN_ISSUE_ACTION;
    };
    (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
      openedUri = uri;
      return true;
    };

    try {
      await vscode.env.clipboard.writeText('');

      await vscode.commands.executeCommand(commandId('showNotification'), message, 'error');

      assert.deepStrictEqual(messages, [message]);
      assert.deepStrictEqual(items, [['OK', COPY_AND_OPEN_ISSUE_ACTION]]);
      assert.strictEqual(await vscode.env.clipboard.readText(), message);
      assert.strictEqual(openedUri?.toString(), ISSUE_URL);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      (vscode.env as any).openExternal = originalOpenExternal;
      await vscode.env.clipboard.writeText('');
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
