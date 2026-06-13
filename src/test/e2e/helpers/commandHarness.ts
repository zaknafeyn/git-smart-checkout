import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { EXTENSION_NAME } from '../../../const';

import { TestRepo } from './gitTestRepo';

/**
 * Shared harness for e2e tests that drive the real contributed commands through
 * `vscode.commands.executeCommand`. These helpers temporarily point the VS Code
 * workspace at a temp test repo and stub the window prompts (quick picks, input
 * boxes, notifications) the commands rely on.
 */

export type QuickPickLikeItem = vscode.QuickPickItem & {
  ref?: { name: string; fullName: string; remote?: string; isTag?: boolean };
  type?: string;
  worktree?: { path: string };
  hasChanges?: boolean;
};

export const commandId = (name: string): string => `${EXTENSION_NAME}.${name}`;

export function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function visualPause(): Promise<void> {
  const ms = Number(process.env.GSC_E2E_VISUAL_DELAY_MS ?? '0');
  if (ms > 0) {
    await delay(ms);
  }
}

/** Run `run` with the VS Code workspace pointed at the test repo, then restore it. */
export async function withRepoWorkspace(repo: TestRepo, run: () => Promise<void>): Promise<void> {
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

export async function ensureExtensionActivated(): Promise<void> {
  const extension = vscode.extensions.all.find(
    (item) => item.packageJSON?.name === EXTENSION_NAME
  );

  assert.ok(extension, `Extension ${EXTENSION_NAME} should be installed in the test host.`);
  await extension.activate();
}

export async function setExtensionMode(mode: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(EXTENSION_NAME)
    .update('mode', mode, vscode.ConfigurationTarget.Global);
  await delay(50);
}

export function stubCreateQuickPick(
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

export function stubShowQuickPick(
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

export function stubInputBox(
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

export function stubInformationMessages(
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

export function stubWarningMessages(
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

export function stubErrorMessages(): { messages: string[]; restore: () => void } {
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

export function getDefaultWorktreePath(repo: TestRepo, branchName: string): string {
  return path.join(
    path.dirname(repo.repoPath),
    `${path.basename(repo.repoPath)}-${branchName.replace(/[\\/]+/g, '-')}`
  );
}

export async function cleanupWorktree(repo: TestRepo, worktreePath: string): Promise<void> {
  try {
    await repo.git.worktreeRemove(worktreePath);
  } catch {
    // The worktree may not have been created if the command failed before that point.
  }

  fs.rmSync(worktreePath, { recursive: true, force: true });
}

export function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

export function normalizeTestPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function isSameTestPath(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }

  return normalizeTestPath(left) === normalizeTestPath(right);
}
