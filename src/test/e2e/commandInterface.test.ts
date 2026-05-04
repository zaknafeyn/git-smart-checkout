import * as assert from 'assert';
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

function stubInputBox(...answers: string[]): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  const queue = [...answers];

  (vscode.window as any).showInputBox = async () => queue.shift();

  return () => {
    (vscode.window as any).showInputBox = original;
  };
}

function stubInformationMessages(
  pick: (message: string, items: readonly string[]) => string | undefined
): { messages: string[]; restore: () => void } {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  const messages: string[] = [];

  (vscode.window as any).showInformationMessage = async (message: string, ...args: any[]) => {
    messages.push(message);
    const items = typeof args[0] === 'object' && typeof args[0] !== 'string'
      ? args.slice(1)
      : args;
    return pick(message, items);
  };

  return {
    messages,
    restore() {
      (vscode.window as any).showInformationMessage = original;
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
