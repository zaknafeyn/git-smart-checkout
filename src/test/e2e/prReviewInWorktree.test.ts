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
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';

import { createForkPRTestRepo, createPRTestRepo, ForkPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

function makeMockConfigManager(): ConfigurationManager {
  return {
    get: () => ({
      defaultWorktreeDirectory: '',
    }),
  } as unknown as ConfigurationManager;
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

class TestablePRReviewInWorktreeCommand extends PRReviewInWorktreeCommand {
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

function stubInfoMessages(messages: string[], itemsList: string[][] = []): () => void {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
    messages.push(message);
    itemsList.push(items);
    return undefined;
  };
  return () => { (vscode.window as any).showInformationMessage = original; };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showErrorMessage = original; };
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
    // The worktree may not have been created if the command failed before that point.
  }

  fs.rmSync(worktreePath, { recursive: true, force: true });
}

function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

function assertSamePath(actual: string, expected: string): void {
  assert.strictEqual(fs.realpathSync.native(actual), fs.realpathSync.native(expected));
}

describe('PRReviewInWorktreeCommand', () => {
  describe('input parsing', () => {
    for (const input of ['42', '#42', 'https://github.com/owner/test-repo/pull/42']) {
      it(`accepts input "${input}" and fetches PR #42`, async () => {
        const repo = createPRTestRepo();
        const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
        let fetchedNumber: number | undefined;
        const infoMessages: string[] = [];
        const restoreInput = stubInputBox(input, (options) => options.value);
        const restoreInfo = stubInfoMessages(infoMessages);
        const restoreError = stubErrorMessages([]);

        repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

        try {
          const sut = new TestablePRReviewInWorktreeCommand(repo.git, (prNumber) => {
            fetchedNumber = prNumber;
            return makePR(repo.prBranch, { number: prNumber });
          });

          await sut.execute();

          assert.strictEqual(fetchedNumber, 42);
          assert.strictEqual(execIn(worktreePath, 'git branch --show-current').trim(), repo.prBranch);
          assert.ok(infoMessages.some((message) => message.includes('PR #42 worktree created')));
        } finally {
          restoreError();
          restoreInfo();
          restoreInput();
          await cleanupWorktree(repo, worktreePath);
          repo.cleanup();
        }
      });
    }

    it('rejects a PR URL from a different repository before fetching it', async () => {
      const repo = createPRTestRepo();
      let fetchedNumber: number | undefined;
      const errors: string[] = [];
      const restoreInput = stubInputBox('https://github.com/other-org/other-repo/pull/57');
      const restoreErrors = stubErrorMessages(errors);

      repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

      try {
        const sut = new TestablePRReviewInWorktreeCommand(repo.git, (prNumber) => {
          fetchedNumber = prNumber;
          return makePR(repo.prBranch, { number: prNumber });
        });

        await sut.execute();

        assert.strictEqual(fetchedNumber, undefined);
        assert.deepStrictEqual(errors, [
          'This PR URL belongs to other-org/other-repo, but the current repository is owner/test-repo.',
        ]);
      } finally {
        restoreErrors();
        restoreInput();
        repo.cleanup();
      }
    });
  });

  it('creates a local tracking worktree for a same-repo PR', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const infoMessages: string[] = [];
    const actionItems: string[][] = [];
    const restoreInput = stubInputBox('42', (options) => {
      assert.strictEqual(options.value, `${path.basename(repo.repoPath)}-${repo.prBranch}`);
      return options.value;
    });
    const restoreInfo = stubInfoMessages(infoMessages, actionItems);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    try {
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, makePR(repo.prBranch));

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(execIn(worktreePath, 'git branch --show-current').trim(), repo.prBranch);
      assert.strictEqual(
        execIn(worktreePath, `git rev-parse --abbrev-ref ${repo.prBranch}@{upstream}`).trim(),
        `origin/${repo.prBranch}`
      );
      assert.deepStrictEqual(actionItems[0], [
        'Add to Workspace',
        'Open in Current Window',
        'Open in New Window',
      ]);
      assert.ok(infoMessages.some((message) => message.includes('PR #42 worktree created')));
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('records PR review worktree metadata after creating a worktree', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const restoreInput = stubInputBox('42', (options) => options.value);
    const restoreInfo = stubInfoMessages([]);
    const restoreError = stubErrorMessages([]);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    try {
      const sut = new TestablePRReviewInWorktreeCommand(
        repo.git,
        makePR(repo.prBranch),
        store
      );

      await sut.execute();

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
      assertSamePath(records[0].worktreePath, worktreePath);
      assert.strictEqual(records[0].branchName, repo.prBranch);
      assert.strictEqual(records[0].prNumber, 42);
      assert.strictEqual(records[0].prTitle, 'Test PR title');
      assert.strictEqual(records[0].prUrl, 'https://github.com/owner/repo/pull/42');
      assert.strictEqual(records[0].headSha, 'abc123');
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('fetches fork PR branches from the fork clone URL and creates a worktree', async () => {
    const repo: ForkPRTestRepo = createForkPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.forkBranch);
    const restoreInput = stubInputBox('99', (options) => options.value);
    const restoreInfo = stubInfoMessages([]);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    try {
      const pr = makePR(repo.forkBranch, {
        number: 99,
        head: {
          ref: repo.forkBranch,
          sha: 'def456',
          repo: { full_name: 'fork-owner/repo', clone_url: repo.forkRepoPath },
        },
        base: { ref: 'main', repo: { full_name: 'owner/repo' } },
      });
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, pr);

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(execIn(worktreePath, 'git branch --show-current').trim(), repo.forkBranch);
      assert.strictEqual(fs.existsSync(path.join(worktreePath, 'fork.txt')), true);
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('offers standard actions when the PR branch is already checked out in a worktree', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const infoMessages: string[] = [];
    const actionItems: string[][] = [];
    const restoreInput = stubInputBox('42');
    const restoreInfo = stubInfoMessages(infoMessages, actionItems);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });
    repo.exec(`git fetch origin ${repo.prBranch}:refs/remotes/origin/${repo.prBranch}`);
    repo.exec(`git worktree add --track -b ${repo.prBranch} "${worktreePath}" origin/${repo.prBranch}`);

    try {
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, makePR(repo.prBranch));

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(infoMessages.length, 1);
      assert.ok(infoMessages[0].includes(`Branch "${repo.prBranch}" is already checked out`));
      assert.deepStrictEqual(actionItems[0], [
        'Add to Workspace',
        'Open in Current Window',
        'Open in New Window',
      ]);
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('records PR review worktree metadata when the PR branch is already checked out', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const store = new PRReviewWorktreeStore(makeMemoryMemento(), mockLogService);
    const restoreInput = stubInputBox('42');
    const restoreInfo = stubInfoMessages([]);
    const restoreError = stubErrorMessages([]);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });
    repo.exec(`git fetch origin ${repo.prBranch}:refs/remotes/origin/${repo.prBranch}`);
    repo.exec(`git worktree add --track -b ${repo.prBranch} "${worktreePath}" origin/${repo.prBranch}`);

    try {
      const sut = new TestablePRReviewInWorktreeCommand(
        repo.git,
        makePR(repo.prBranch),
        store
      );

      await sut.execute();

      const records = await store.getForRepository({
        repoKey: 'owner/test-repo',
        repositoryPath: repo.repoPath,
      });
      assert.strictEqual(records.length, 1);
      assertSamePath(records[0].worktreePath, worktreePath);
      assert.strictEqual(records[0].branchName, repo.prBranch);
      assert.strictEqual(records[0].prNumber, 42);
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('leaves current uncommitted changes untouched and does not create a stash', async () => {
    const repo = createPRTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.prBranch);
    const restoreInput = stubInputBox('42', (options) => options.value);
    const restoreInfo = stubInfoMessages([]);
    const errors: string[] = [];
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    try {
      repo.makeChange('file1.txt', 'dirty review notes\n');
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, makePR(repo.prBranch));

      await sut.execute();

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(repo.readFile('file1.txt'), 'dirty review notes\n');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
      assert.strictEqual(repo.stashCount(), 0);
      assert.strictEqual(execIn(worktreePath, 'git status --porcelain').trim(), '');
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('shows an error for invalid PR input', async () => {
    const repo = createPRTestRepo();
    const errors: string[] = [];
    const restoreInput = stubInputBox('not-a-pr');
    const restoreInfo = stubInfoMessages([]);
    const restoreError = stubErrorMessages(errors);

    try {
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, makePR(repo.prBranch));

      await sut.execute();

      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].includes('Invalid input'));
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      repo.cleanup();
    }
  });

  it('shows an error when fetching PR metadata fails', async () => {
    const repo = createPRTestRepo();
    const errors: string[] = [];
    const restoreInput = stubInputBox('42');
    const restoreInfo = stubInfoMessages([]);
    const restoreError = stubErrorMessages(errors);

    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    try {
      const sut = new TestablePRReviewInWorktreeCommand(repo.git, new Error('boom'));

      await sut.execute();

      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].includes('Failed to fetch PR #42: boom'));
    } finally {
      restoreError();
      restoreInfo();
      restoreInput();
      repo.cleanup();
    }
  });
});
