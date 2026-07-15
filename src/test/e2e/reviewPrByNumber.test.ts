import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { RemovePRReviewInWorktreeCommand } from '../../commands/removePRReviewInWorktreeCommand';
import {
  ACTION_OPEN_EXISTING,
  ACTION_REVIEW,
  ACTION_UPDATE_TO_LATEST,
  getReviewBranchName,
  ReviewPrByNumberCommand,
} from '../../commands/reviewPrByNumberCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';

import { createPRNumberTestRepo, PRNumberTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

function makeMockConfigManager(): ConfigurationManager {
  return {
    get: () => ({
      defaultWorktreeDirectory: '',
    }),
  } as unknown as ConfigurationManager;
}

function makePR(prNumber: number, overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: prNumber,
    title: 'Test PR title',
    body: '',
    user: { login: 'alice' },
    head: { ref: 'unused-head-ref', sha: 'unused', repo: { full_name: 'owner/repo', clone_url: '' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    html_url: `https://github.com/owner/repo/pull/${prNumber}`,
    labels: [],
    assignees: [],
    ...overrides,
  } as unknown as GitHubPR;
}

class TestableReviewPrByNumberCommand extends ReviewPrByNumberCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly prData: GitHubPR | Error | ((prNumber: number) => GitHubPR),
    store?: PRReviewWorktreeStore
  ) {
    super(makeMockConfigManager(), mockLogService, undefined, store);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }

  protected createGitHubClient(_owner: string, _repo: string): GitHubClient {
    const prData = this.prData;
    return {
      fetchPullRequest: async (prNumber: number) => {
        if (prData instanceof Error) { throw prData; }
        return typeof prData === 'function' ? prData(prNumber) : prData;
      },
    } as unknown as GitHubClient;
  }
}

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

function getDefaultWorktreePath(repo: PRNumberTestRepo, branchName: string): string {
  return path.join(
    path.dirname(repo.repoPath),
    `${path.basename(repo.repoPath)}-${branchName.replace(/[\\/]+/g, '-')}`
  );
}

async function cleanupWorktree(repo: PRNumberTestRepo, worktreePath: string): Promise<void> {
  try {
    await repo.git.worktreeRemove(worktreePath);
  } catch {
    // The worktree may not have been created, or may already have been removed.
  }

  fs.rmSync(worktreePath, { recursive: true, force: true });
}

function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

function assertSamePath(actual: string, expected: string): void {
  assert.strictEqual(fs.realpathSync.native(actual), fs.realpathSync.native(expected));
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

function stubInformationMessages(
  responses: Array<string | undefined> = []
): { messages: string[]; itemsList: string[][]; restore: () => void } {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  const messages: string[] = [];
  const itemsList: string[][] = [];
  const queue = [...responses];

  (vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
    messages.push(message);
    itemsList.push(items);
    return queue.shift();
  };

  return { messages, itemsList, restore() { (vscode.window as any).showInformationMessage = original; } };
}

function stubWarningMessages(
  responses: Array<string | undefined> = []
): { messages: string[]; restore: () => void } {
  const original = vscode.window.showWarningMessage.bind(vscode.window);
  const messages: string[] = [];
  const queue = [...responses];

  (vscode.window as any).showWarningMessage = async (message: string) => {
    messages.push(message);
    return queue.shift();
  };

  return { messages, restore() { (vscode.window as any).showWarningMessage = original; } };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showErrorMessage = original; };
}

describe('ReviewPrByNumberCommand (e2e)', () => {
  it('creates a pr/<n>-review worktree at the fetched PR head and records the store entry', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const restoreInput = stubInputBox('7');
    const info = stubInformationMessages([ACTION_REVIEW]);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    try {
      const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(fs.existsSync(worktreePath), true);
      assert.strictEqual(execIn(worktreePath, 'git branch --show-current').trim(), branchName);
      assert.strictEqual(execIn(worktreePath, 'git rev-parse HEAD').trim(), repo.headSha);

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
      assertSamePath(records[0].worktreePath, worktreePath);
      assert.strictEqual(records[0].branchName, branchName);
      assert.strictEqual(records[0].prNumber, 7);
      assert.strictEqual(records[0].headSha, repo.headSha);
      assert.ok(info.messages.some((message) => message.includes("Review PR #7 'Test PR title' by @alice")));
      assert.ok(info.messages.some((message) => message.includes('Remove PR Review in Worktree')));
    } finally {
      restoreError();
      info.restore();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('re-invoking offers Open existing without creating a duplicate worktree', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    // First invocation creates the worktree.
    {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_REVIEW]);
      const restoreError = stubErrorMessages([]);
      try {
        const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
        await sut.execute();
      } finally {
        restoreError();
        info.restore();
        restoreInput();
      }
    }

    try {
      const worktreesBefore = fs.readdirSync(path.dirname(worktreePath)).length;

      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_OPEN_EXISTING]);
      const errors: string[] = [];
      const restoreError = stubErrorMessages(errors);

      const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
      await sut.execute();

      restoreError();
      info.restore();
      restoreInput();

      assert.deepStrictEqual(errors, []);
      assert.ok(
        info.messages.some((message) => message.includes('already exists at')),
        'expected the three-way re-invocation prompt'
      );
      assert.deepStrictEqual(info.itemsList.find((items) => items.includes('Open existing')), [
        'Open existing',
        'Update to latest head',
        'Remove and recreate',
      ]);

      const worktreesAfter = fs.readdirSync(path.dirname(worktreePath)).length;
      assert.strictEqual(worktreesAfter, worktreesBefore, 'must not create a duplicate worktree');

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
    } finally {
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('Update to latest head moves the worktree to the newly advanced PR head', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    // First invocation creates the worktree at the original head.
    {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_REVIEW]);
      const restoreError = stubErrorMessages([]);
      try {
        const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
        await sut.execute();
      } finally {
        restoreError();
        info.restore();
        restoreInput();
      }
    }

    const newHeadSha = repo.advancePullRef();
    assert.notStrictEqual(newHeadSha, repo.headSha);

    try {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_UPDATE_TO_LATEST]);
      const warnings = stubWarningMessages([ACTION_UPDATE_TO_LATEST]);
      const errors: string[] = [];
      const restoreError = stubErrorMessages(errors);

      const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
      await sut.execute();

      restoreError();
      warnings.restore();
      info.restore();
      restoreInput();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(execIn(worktreePath, 'git rev-parse HEAD').trim(), newHeadSha);

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records[0].headSha, newHeadSha);
    } finally {
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('refuses to update when the review worktree has uncommitted changes', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_REVIEW]);
      const restoreError = stubErrorMessages([]);
      try {
        const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
        await sut.execute();
      } finally {
        restoreError();
        info.restore();
        restoreInput();
      }
    }

    fs.writeFileSync(path.join(worktreePath, 'pr.txt'), 'locally dirtied\n');
    const newHeadSha = repo.advancePullRef();

    try {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_UPDATE_TO_LATEST]);
      const warnings = stubWarningMessages([]);
      const errors: string[] = [];
      const restoreError = stubErrorMessages(errors);

      const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
      await sut.execute();

      restoreError();
      warnings.restore();
      info.restore();
      restoreInput();

      assert.deepStrictEqual(errors, []);
      assert.ok(warnings.messages.some((message) => message.includes('uncommitted changes')));
      assert.strictEqual(
        execIn(worktreePath, 'git rev-parse HEAD').trim(),
        repo.headSha,
        'must not reset --hard a dirty worktree'
      );
      assert.notStrictEqual(execIn(worktreePath, 'git rev-parse HEAD').trim(), newHeadSha);
      assert.strictEqual(fs.readFileSync(path.join(worktreePath, 'pr.txt'), 'utf-8'), 'locally dirtied\n');
    } finally {
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('tears down via RemovePRReviewInWorktree: worktree and store record removed', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    {
      const restoreInput = stubInputBox('7');
      const info = stubInformationMessages([ACTION_REVIEW]);
      const restoreError = stubErrorMessages([]);
      try {
        const sut = new TestableReviewPrByNumberCommand(repo.git, makePR(7), store);
        await sut.execute();
      } finally {
        restoreError();
        info.restore();
        restoreInput();
      }
    }

    assert.strictEqual(fs.existsSync(worktreePath), true);

    try {
      const original = vscode.window.showQuickPick.bind(vscode.window);
      (vscode.window as any).showQuickPick = async (items: readonly any[]) =>
        items.find((item) => typeof item !== 'string' && item.record?.prNumber === 7);
      const info = stubInformationMessages([]);
      const warnings = stubWarningMessages([]);
      const errors: string[] = [];
      const restoreError = stubErrorMessages(errors);

      try {
        const sut = new TestableRemovePRReviewInWorktreeCommand(repo.git, store);
        await sut.execute();
      } finally {
        restoreError();
        warnings.restore();
        info.restore();
        (vscode.window as any).showQuickPick = original;
      }

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(fs.existsSync(worktreePath), false);

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 0);
    } finally {
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('fork simulation: never fetches a head-ref branch, only the synthetic pull/<n>/head ref', async () => {
    const repo = createPRNumberTestRepo(7);
    const branchName = getReviewBranchName(7);
    const worktreePath = getDefaultWorktreePath(repo, branchName);
    const restoreInput = stubInputBox('7');
    const info = stubInformationMessages([ACTION_REVIEW]);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });

    const fetchSpecificBranchCalls: unknown[] = [];
    const fetchFromUrlCalls: unknown[] = [];
    const originalFetchSpecificBranch = repo.git.fetchSpecificBranch.bind(repo.git);
    const originalFetchFromUrl = repo.git.fetchFromUrl.bind(repo.git);
    (repo.git as any).fetchSpecificBranch = async (...args: unknown[]) => {
      fetchSpecificBranchCalls.push(args);
      return originalFetchSpecificBranch(...(args as [string, string?]));
    };
    (repo.git as any).fetchFromUrl = async (...args: unknown[]) => {
      fetchFromUrlCalls.push(args);
      return originalFetchFromUrl(...(args as [string, string, boolean?]));
    };

    try {
      const pr = makePR(7, {
        head: { ref: 'fork-owner:fork-branch', sha: 'irrelevant', repo: { full_name: 'fork-owner/repo', clone_url: repo.remoteRepoPath } },
      });
      const sut = new TestableReviewPrByNumberCommand(repo.git, pr);

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.deepStrictEqual(fetchSpecificBranchCalls, []);
      assert.deepStrictEqual(fetchFromUrlCalls, []);
      assert.strictEqual(execIn(worktreePath, 'git rev-parse HEAD').trim(), repo.headSha);
    } finally {
      restoreError();
      info.restore();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });
});
