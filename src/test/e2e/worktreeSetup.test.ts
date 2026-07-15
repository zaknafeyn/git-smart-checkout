import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PRReviewInWorktreeCommand } from '../../commands/prReviewInWorktreeCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { ExtensionConfig } from '../../configuration/extensionConfig';
import { WorktreeSetupMemento, WorktreeSetupService } from '../../services/worktreeSetupService';
import { GitHubPR } from '../../types/dataTypes';

import { createPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

/**
 * E2E coverage for Feature 6 (worktree setup: local-file carry + setup command)
 * driven through `PRReviewInWorktreeCommand`, one of the creation paths the
 * spec requires setup to run on. `moveToNewWorktreeCommand` shares the exact
 * same `completeWorktreeCreation` entry point (see worktreeSetupService.test.ts
 * for direct service-level coverage of the glob matching / consent / failure /
 * cancellation semantics).
 */

function makeMockConfigManager(worktreeSetup: Partial<ExtensionConfig['worktreeSetup']> = {}): ConfigurationManager {
  const config = {
    defaultWorktreeDirectory: '',
    worktreeSetup: {
      copyFiles: [],
      command: '',
      applyToPrCloneWorktrees: false,
      ...worktreeSetup,
    },
  } as unknown as ExtensionConfig;

  return { get: () => config } as unknown as ConfigurationManager;
}

function makeMemento(): WorktreeSetupMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: (<T>(key: string, defaultValue?: T) =>
      store.has(key) ? (store.get(key) as T) : defaultValue) as WorktreeSetupMemento['get'],
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

function makePR(headRef: string, overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 42,
    title: 'Test PR title',
    body: '',
    head: { ref: headRef, sha: 'abc123', repo: { full_name: 'owner/repo', clone_url: '' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    html_url: 'https://github.com/owner/repo/pull/42',
    labels: [],
    assignees: [],
    ...overrides,
  };
}

class TestableCommand extends PRReviewInWorktreeCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly prData: GitHubPR,
    configManager: ConfigurationManager,
    worktreeSetupService: WorktreeSetupService
  ) {
    super(configManager, mockLogService, undefined, undefined, worktreeSetupService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }

  protected createGitHubClient(_owner: string, _repo: string): GitHubClient {
    const prData = this.prData;
    return {
      fetchPullRequest: async () => prData,
    } as unknown as GitHubClient;
  }
}

function stubInputBox(...answers: Array<string | ((options: vscode.InputBoxOptions) => string | undefined)>): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  const queue = [...answers];
  (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
    const answer = queue.shift();
    return typeof answer === 'function' ? answer(options) : answer;
  };
  return () => { (vscode.window as any).showInputBox = original; };
}

function stubInfoMessages(): { messages: string[]; restore: () => void } {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  const messages: string[] = [];
  (vscode.window as any).showInformationMessage = async (message: string) => {
    messages.push(message);
    return undefined;
  };
  return { messages, restore: () => { (vscode.window as any).showInformationMessage = original; } };
}

function stubWarningMessages(response: string | undefined): { stats: { calls: number }; restore: () => void } {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  const stats = { calls: 0 };
  (vscode.window as any).showWarningMessage = async (..._args: unknown[]) => {
    stats.calls += 1;
    return response;
  };
  return { stats, restore: () => { (vscode.window as any).showWarningMessage = original; } };
}

function getDefaultWorktreePath(repo: PRTestRepo, branchName: string): string {
  return path.join(
    path.dirname(repo.repoPath),
    `${path.basename(repo.repoPath)}-${branchName.replace(/[\\/]+/g, '-')}`
  );
}

async function cleanupWorktree(repo: PRTestRepo, worktreePath: string): Promise<void> {
  try {
    await repo.git.worktreeRemove(worktreePath);
  } catch {
    // May not have been created.
  }
  fs.rmSync(worktreePath, { recursive: true, force: true });
}

describe('Worktree setup hooks (copyFiles / command)', () => {
  it('copies matching untracked/ignored local files into the new worktree and reports the count', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);

    fs.writeFileSync(path.join(repo.repoPath, '.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(repo.repoPath, 'notes.local'), 'scratch notes\n');
    fs.writeFileSync(path.join(repo.repoPath, '.gitignore'), 'dist/\n');

    const configManager = makeMockConfigManager({ copyFiles: ['.env*', '*.local'] });
    const worktreeSetupService = new WorktreeSetupService(configManager, mockLogService, makeMemento());

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    const restoreInput = stubInputBox('42', (options) => options.value);
    const info = stubInfoMessages();

    try {
      const sut = new TestableCommand(repo.git, makePR(repo.prBranch), configManager, worktreeSetupService);
      await sut.execute();

      assert.strictEqual(
        fs.readFileSync(path.join(worktreePath, '.env'), 'utf-8'),
        'SECRET=1\n'
      );
      assert.strictEqual(
        fs.readFileSync(path.join(worktreePath, 'notes.local'), 'utf-8'),
        'scratch notes\n'
      );
      assert.ok(
        info.messages.some((message) => message.includes('Copied 2 local file(s)')),
        `Expected a completion toast mentioning the copied file count, got: ${JSON.stringify(info.messages)}`
      );
    } finally {
      info.restore();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('runs the setup command in the new worktree only, after a one-time confirmation', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);

    const configManager = makeMockConfigManager({
      command: `node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"`,
    });
    const worktreeSetupService = new WorktreeSetupService(configManager, mockLogService, makeMemento());

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    const restoreInput = stubInputBox('42', (options) => options.value);
    const info = stubInfoMessages();
    const warning = stubWarningMessages('Run');

    try {
      const sut = new TestableCommand(repo.git, makePR(repo.prBranch), configManager, worktreeSetupService);
      await sut.execute();

      assert.strictEqual(warning.stats.calls, 1, 'expected a one-time confirmation prompt');
      assert.strictEqual(
        fs.readFileSync(path.join(worktreePath, 'setup-ran.txt'), 'utf-8'),
        'ok'
      );
      // The marker must only exist in the new worktree, never the source repo.
      assert.strictEqual(fs.existsSync(path.join(repo.repoPath, 'setup-ran.txt')), false);
    } finally {
      warning.restore();
      info.restore();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('a failing setup command warns with "Show output" but leaves the worktree intact', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);

    const configManager = makeMockConfigManager({ command: 'node -e "process.exit(1)"' });
    const worktreeSetupService = new WorktreeSetupService(configManager, mockLogService, makeMemento());

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    const restoreInput = stubInputBox('42', (options) => options.value);
    const info = stubInfoMessages();
    const original = vscode.window.showWarningMessage.bind(vscode.window);
    const warningCalls: Array<{ message: string; items: string[] }> = [];
    (vscode.window as any).showWarningMessage = async (message: string, ...items: string[]) => {
      warningCalls.push({ message, items });
      // First call is the one-time run confirmation ("Always" so the command
      // actually executes); the failure toast that follows is left dismissed.
      return warningCalls.length === 1 ? 'Always' : undefined;
    };

    try {
      const sut = new TestableCommand(repo.git, makePR(repo.prBranch), configManager, worktreeSetupService);
      await sut.execute();

      assert.strictEqual(fs.existsSync(worktreePath), true, 'worktree must still be created');
      const failureWarning = warningCalls.find((call) => call.message.toLowerCase().includes('exited with code'));
      assert.ok(failureWarning, `Expected a failure warning, got: ${JSON.stringify(warningCalls)}`);
      assert.ok(failureWarning!.items.includes('Show output'));
    } finally {
      (vscode.window as any).showWarningMessage = original;
      info.restore();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('"Never" is persisted so a second worktree creation in the same workspace does not re-prompt or run the command', async () => {
    const repo = createPRTestRepo();

    const configManager = makeMockConfigManager({ command: `node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"` });
    const sharedMemento = makeMemento();
    const worktreeSetupService = new WorktreeSetupService(configManager, mockLogService, sharedMemento);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    // First worktree: user declines permanently via "Never".
    const worktreePath1 = getDefaultWorktreePath(repo, repo.prBranch);
    const restoreInput1 = stubInputBox('42', (options) => options.value);
    const info1 = stubInfoMessages();
    const warning1 = stubWarningMessages('Never');

    try {
      const sut1 = new TestableCommand(repo.git, makePR(repo.prBranch), configManager, worktreeSetupService);
      await sut1.execute();
      assert.strictEqual(warning1.stats.calls, 1);
      assert.strictEqual(fs.existsSync(path.join(worktreePath1, 'setup-ran.txt')), false);
    } finally {
      warning1.restore();
      info1.restore();
      restoreInput1();
    }

    // Second PR review worktree in the same workspace: must not prompt again, must not run.
    const secondBranch = 'pr-feature-2';
    execSync(`git checkout -b ${secondBranch}`, { cwd: repo.repoPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(repo.repoPath, 'extra.txt'), 'extra\n');
    execSync('git add extra.txt', { cwd: repo.repoPath, stdio: 'pipe' });
    execSync('git commit -m "extra"', { cwd: repo.repoPath, stdio: 'pipe' });
    execSync(`git push -u origin ${secondBranch}`, { cwd: repo.repoPath, stdio: 'pipe' });
    execSync('git checkout main', { cwd: repo.repoPath, stdio: 'pipe' });
    execSync(`git branch -D ${secondBranch}`, { cwd: repo.repoPath, stdio: 'pipe' });

    const worktreePath2 = getDefaultWorktreePath(repo, secondBranch);
    const restoreInput2 = stubInputBox('99', (options) => options.value);
    const info2 = stubInfoMessages();
    const noPromptStats = { calls: 0 };
    const originalWarn = vscode.window.showWarningMessage.bind(vscode.window);
    (vscode.window as any).showWarningMessage = async () => {
      noPromptStats.calls += 1;
      return undefined;
    };

    try {
      const sut2 = new TestableCommand(repo.git, makePR(secondBranch, { number: 99 }), configManager, worktreeSetupService);
      await sut2.execute();

      assert.strictEqual(noPromptStats.calls, 0, 'must not prompt again after "Never" was persisted');
      assert.strictEqual(fs.existsSync(path.join(worktreePath2, 'setup-ran.txt')), false);
    } finally {
      (vscode.window as any).showWarningMessage = originalWarn;
      info2.restore();
      restoreInput2();
      await cleanupWorktree(repo, worktreePath2);
      await cleanupWorktree(repo, worktreePath1);
      repo.cleanup();
    }
  });
});
