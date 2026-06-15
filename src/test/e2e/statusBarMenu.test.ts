import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  AUTO_STASH_MODE_BRANCH,
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODES_DETAILS,
} from '../../configuration/extensionConfig';
import { EXTENSION_NAME } from '../../const';

type MenuItem = vscode.QuickPickItem & { commandId?: string };

const commandId = (name: string) => `${EXTENSION_NAME}.${name}`;

const MENU_PLACEHOLDER = 'Select an action';

const EXPECTED_ACTIONS = [
  'switchMode',
  'checkoutTo',
  'checkoutPrevious',
  'checkoutByPR',
  'pullWithStash',
  'pullRebaseWithStash',
  'rebaseWithStash',
  'moveToNewWorktree',
  'clonePullRequest',
];

function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getMode(): string | undefined {
  return vscode.workspace.getConfiguration(EXTENSION_NAME).get<string>('mode');
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

describe('status bar quick actions menu', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  beforeEach(async () => {
    await setExtensionMode(AUTO_STASH_MODE_MANUAL);
  });

  afterEach(async () => {
    await setExtensionMode(AUTO_STASH_MODE_MANUAL);
  });

  it('contributes the quick actions command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(commandId('showStatusBarMenu')));
  });

  it('lists the expected actions grouped by separators', async () => {
    let inspected = false;
    const restore = stubShowQuickPick((items, options) => {
      if (options?.placeHolder !== MENU_PLACEHOLDER) {
        return undefined;
      }

      inspected = true;
      const menuItems = items as readonly MenuItem[];

      const actionCommands = menuItems
        .filter((item) => typeof item !== 'string' && item.commandId)
        .map((item) => item.commandId);

      for (const name of EXPECTED_ACTIONS) {
        assert.ok(
          actionCommands.includes(commandId(name)),
          `menu should include the ${name} action`
        );
      }

      const separators = menuItems.filter(
        (item) =>
          typeof item !== 'string' && item.kind === vscode.QuickPickItemKind.Separator
      );
      assert.ok(separators.length >= 4, 'menu should group actions with separators');

      const switchModeItem = menuItems.find(
        (item) => item.commandId === commandId('switchMode')
      );
      assert.ok(
        switchModeItem?.description?.includes(
          AUTO_STASH_MODES_DETAILS[AUTO_STASH_MODE_MANUAL].briefLabel
        ),
        'switch mode action should show the current mode in its description'
      );

      // Dismiss the menu without selecting anything.
      return undefined;
    });

    try {
      await vscode.commands.executeCommand(commandId('showStatusBarMenu'));

      assert.strictEqual(inspected, true);
      // Dismissing the menu must be a no-op.
      assert.strictEqual(getMode(), AUTO_STASH_MODE_MANUAL);
    } finally {
      restore();
    }
  });

  it('runs the selected action (switch stash mode)', async () => {
    const targetLabel = AUTO_STASH_MODES_DETAILS[AUTO_STASH_MODE_BRANCH].label;
    let openedMenu = false;
    let openedModePicker = false;

    const restore = stubShowQuickPick((items, options) => {
      const menuItems = items as readonly MenuItem[];

      if (options?.placeHolder === MENU_PLACEHOLDER) {
        openedMenu = true;
        return menuItems.find((item) => item.commandId === commandId('switchMode'));
      }

      // The switchMode command opens its own mode picker.
      openedModePicker = true;
      return menuItems.find(
        (item) => typeof item !== 'string' && item.label.includes(targetLabel)
      );
    });

    try {
      await vscode.commands.executeCommand(commandId('showStatusBarMenu'));
      await delay(100);

      assert.strictEqual(openedMenu, true, 'the quick actions menu should be shown');
      assert.strictEqual(openedModePicker, true, 'selecting switch mode should open the mode picker');
      assert.strictEqual(getMode(), AUTO_STASH_MODE_BRANCH);
    } finally {
      restore();
    }
  });
});
