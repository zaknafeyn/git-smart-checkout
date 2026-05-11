import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { RemovePRReviewInWorktreeCommand } from '../../commands/removePRReviewInWorktreeCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import {
  PRReviewWorktreeRecordInput,
  PRReviewWorktreeStore,
} from '../../services/prReviewWorktreeStore';

import { createPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

type QuickPickLikeItem = vscode.QuickPickItem & {
  record?: { id: string; prNumber: number; worktreePath: string };
  worktree?: { path: string };
};

class TestableRemovePRReviewInWorktreeCommand extends RemovePRReviewInWorktreeCommand {
  constructor(
    private readonly testGit: GitExecutor,
    store: PRReviewWorktreeStore
  ) {
    super(mockLogService, store);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }
}

function makeMemoryMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const data = new Map<string, unknown>();

  return {
    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        data.delete(key);
        return;
      }

      data.set(key, value);
    },
  } as Pick<vscode.Memento, 'get' | 'update'>;
}

function getDefaultWorktreePath(repo: PRTestRepo, branchName: string): string {
  return path.join(
    path.dirname(repo.repoPath),
    `${path.basename(repo.repoPath)}-${branchName.replace(/[\\/]+/g, '-')}`
  );
}

async function addTrackedPRReviewRecord(
  store: PRReviewWorktreeStore,
  repo: PRTestRepo,
  worktreePath: string,
  overrides: Partial<PRReviewWorktreeRecordInput> = {}
): Promise<void> {
  await store.upsert({
    repositoryPath: repo.repoPath,
    worktreePath,
    branchName: repo.prBranch,
    prNumber: 42,
    prTitle: 'Test PR title',
    prUrl: 'https://github.com/owner/repo/pull/42',
    headSha: 'abc123',
    ...overrides,
  });
}

function createPRWorktree(repo: PRTestRepo, worktreePath: string): void {
  repo.exec(`git fetch origin ${repo.prBranch}:refs/remotes/origin/${repo.prBranch}`);
  repo.exec(`git worktree add --track -b ${repo.prBranch} "${worktreePath}" origin/${repo.prBranch}`);
}

async function cleanupWorktree(repo: PRTestRepo, worktreePath: string): Promise<void> {
  try {
    await repo.git.worktreeRemove(worktreePath);
  } catch {
    // The worktree may have already been removed by the command under test.
  }

  fs.rmSync(worktreePath, { recursive: true, force: true });
}

function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

function assertSamePath(actual: string, expected: string): void {
  assert.strictEqual(fs.realpathSync.native(actual), fs.realpathSync.native(expected));
}

function stashMessages(repo: PRTestRepo): string[] {
  const output = repo.exec('git stash list --format="%gs"');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

  return () => { (vscode.window as any).showQuickPick = original; };
}

function stubInputBox(
  ...answers: Array<string | ((options: vscode.InputBoxOptions) => string | undefined) | undefined>
): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  const queue = [...answers];

  (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
    const answer = queue.shift();
    return typeof answer === 'function' ? answer(options) : answer;
  };

  return () => { (vscode.window as any).showInputBox = original; };
}

function stubInformationMessages(messages: string[]): () => void {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (message: string) => {
    messages.push(message);
    return undefined;
  };
  return () => { (vscode.window as any).showInformationMessage = original; };
}

function stubWarningMessages(
  pick: (message: string, items: readonly string[]) => string | undefined
): { messages: string[]; restore: () => void } {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  const messages: string[] = [];

  (vscode.window as any).showWarningMessage = async (message: string, ...args: any[]) => {
    messages.push(message);
    const items = typeof args[0] === 'object' && typeof args[0] !== 'string'
      ? args.slice(1)
      : args;
    return pick(message, items);
  };

  return {
    messages,
    restore() {
      (vscode.window as any).showWarningMessage = original;
    },
  };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showErrorMessage = original; };
}

describe('RemovePRReviewInWorktreeCommand', () => {
  it('lists only tracked PR review worktrees and prunes stale records', async () => {
    const repo = createPRTestRepo();
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const prWorktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const staleWorktreePath = `${prWorktreePath}-missing`;
    const manualWorktreePath = `${prWorktreePath}-manual`;
    let pickerItems: QuickPickLikeItem[] = [];

    createPRWorktree(repo, prWorktreePath);
    repo.exec('git branch manual-branch main');
    repo.exec(`git worktree add "${manualWorktreePath}" manual-branch`);
    await addTrackedPRReviewRecord(store, repo, prWorktreePath);
    await addTrackedPRReviewRecord(store, repo, staleWorktreePath, {
      prNumber: 99,
      branchName: 'stale-pr',
      prTitle: 'Stale PR',
      prUrl: 'https://github.com/owner/repo/pull/99',
    });

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select a PR review worktree to remove') {
        pickerItems = items.filter((item): item is QuickPickLikeItem => typeof item !== 'string');
      }

      return undefined;
    });
    const restoreInfo = stubInformationMessages([]);
    const restoreError = stubErrorMessages([]);

    try {
      const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
      await sut.execute();

      assert.strictEqual(pickerItems.length, 1);
      assert.strictEqual(pickerItems[0].record?.prNumber, 42);
      assertSamePath(pickerItems[0].worktree?.path ?? '', prWorktreePath);
      const records = await store.getForRepository({
        repoKey: repo.repoPath,
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
      assertSamePath(records[0].worktreePath, prWorktreePath);
    } finally {
      restoreError();
      restoreInfo();
      restoreQuickPick();
      await cleanupWorktree(repo, prWorktreePath);
      await cleanupWorktree(repo, manualWorktreePath);
      repo.cleanup();
    }
  });

  it('removes a clean PR review worktree immediately', async () => {
    const repo = createPRTestRepo();
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const warnings = stubWarningMessages(() => {
      throw new Error('Clean removal should not show a warning prompt');
    });
    const infoMessages: string[] = [];

    createPRWorktree(repo, worktreePath);
    await addTrackedPRReviewRecord(store, repo, worktreePath);

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select a PR review worktree to remove') {
        return items.find((item) =>
          typeof item !== 'string' &&
          (item as QuickPickLikeItem).record?.prNumber === 42
        ) as vscode.QuickPickItem;
      }

      return undefined;
    });
    const restoreInfo = stubInformationMessages(infoMessages);
    const restoreError = stubErrorMessages([]);

    try {
      const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
      await sut.execute();

      assert.strictEqual(fs.existsSync(worktreePath), false);
      assert.ok(infoMessages.some((message) => message.includes('PR #42 worktree removed')));
      const records = await store.getForRepository({
        repoKey: repo.repoPath,
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 0);
      assert.strictEqual(warnings.messages.length, 0);
    } finally {
      restoreError();
      restoreInfo();
      restoreQuickPick();
      warnings.restore();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('cancels dirty PR review worktree removal without changing files', async () => {
    const repo = createPRTestRepo();
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);

    createPRWorktree(repo, worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'dirty but kept\n');
    await addTrackedPRReviewRecord(store, repo, worktreePath);

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select a PR review worktree to remove') {
        return items.find((item) =>
          typeof item !== 'string' &&
          (item as QuickPickLikeItem).record?.prNumber === 42
        ) as vscode.QuickPickItem;
      }

      return undefined;
    });
    const warnings = stubWarningMessages((_message, items) => {
      assert.deepStrictEqual(items, ['Stash Changes and Remove', 'Cancel']);
      return 'Cancel';
    });
    const restoreInput = stubInputBox(() => {
      throw new Error('Cancel should not ask for a stash name');
    });
    const restoreError = stubErrorMessages([]);

    try {
      const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
      await sut.execute();

      assert.strictEqual(fs.existsSync(worktreePath), true);
      assert.strictEqual(fs.readFileSync(path.join(worktreePath, 'file1.txt'), 'utf-8'), 'dirty but kept\n');
      assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim().length > 0, true);
      const records = await store.getForRepository({
        repoKey: repo.repoPath,
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
    } finally {
      restoreError();
      restoreInput();
      warnings.restore();
      restoreQuickPick();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('stashes dirty changes with an editable branch-date default before removing', async () => {
    const repo = createPRTestRepo();
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);

    createPRWorktree(repo, worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file1.txt'), 'dirty before remove\n');
    fs.writeFileSync(path.join(worktreePath, 'notes.txt'), 'untracked before remove\n');
    await addTrackedPRReviewRecord(store, repo, worktreePath);

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select a PR review worktree to remove') {
        return items.find((item) =>
          typeof item !== 'string' &&
          (item as QuickPickLikeItem).record?.prNumber === 42
        ) as vscode.QuickPickItem;
      }

      return undefined;
    });
    const warnings = stubWarningMessages((_message, items) => {
      assert.deepStrictEqual(items, ['Stash Changes and Remove', 'Cancel']);
      return 'Stash Changes and Remove';
    });
    const restoreInput = stubInputBox((options) => {
      assert.match(options.value ?? '', /^pr-feature_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
      return 'custom-pr-review-stash';
    });
    const restoreInfo = stubInformationMessages([]);
    const restoreError = stubErrorMessages([]);

    try {
      const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
      await sut.execute();

      assert.strictEqual(fs.existsSync(worktreePath), false);
      assert.ok(
        stashMessages(repo).some((message) => message.includes('custom-pr-review-stash')),
        'stash should use the confirmed custom stash name'
      );
      const records = await store.getForRepository({
        repoKey: repo.repoPath,
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 0);
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      warnings.restore();
      restoreQuickPick();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('removes matching open workspace folders after deleting the PR review worktree', async () => {
    const repo = createPRTestRepo();
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
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

    createPRWorktree(repo, worktreePath);
    await addTrackedPRReviewRecord(store, repo, worktreePath);

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
      if (options?.placeHolder === 'Select a PR review worktree to remove') {
        return items.find((item) =>
          typeof item !== 'string' &&
          (item as QuickPickLikeItem).record?.prNumber === 42
        ) as vscode.QuickPickItem;
      }

      return undefined;
    });
    const restoreInfo = stubInformationMessages([]);
    const restoreError = stubErrorMessages([]);

    try {
      const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
      await sut.execute();

      assert.strictEqual(fs.existsSync(worktreePath), false);
      assert.deepStrictEqual(folders.map((folder) => folder.uri.fsPath), [repo.repoPath]);
    } finally {
      restoreError();
      restoreInfo();
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
