import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import {
  ACTION_OPEN_EXISTING,
  ACTION_REMOVE_AND_RECREATE,
  ACTION_REVIEW,
  ACTION_UPDATE_TO_LATEST,
  getReviewBranchName,
  ReviewPrByNumberCommand,
} from '../../commands/reviewPrByNumberCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PRReviewWorktreeRecord, PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

const REPO_PATH = path.join(os.tmpdir(), 'gsc-review-pr-tests', 'repo');
const WORKTREE_BASE = path.join(os.tmpdir(), 'gsc-review-pr-tests', 'worktrees');
const EXISTING_WORKTREE_PATH = path.join(WORKTREE_BASE, 'repo-pr-5-review');
const HEAD_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const prData = (prNumber: number): GitHubPR =>
  ({
    number: prNumber,
    title: 'Fix the thing',
    user: { login: 'alice' },
    head: { ref: 'feat/fix-the-thing', sha: 'abc123' },
    base: { ref: 'main' },
    html_url: `https://github.com/octo/repo/pull/${prNumber}`,
    labels: [],
    assignees: [],
  }) as unknown as GitHubPR;

const configManager = {
  get: () => ({ defaultWorktreeDirectory: WORKTREE_BASE }),
} as unknown as ConfigurationManager;

interface HarnessOptions {
  input?: string;
  repoInfo?: { owner: string; repo: string } | null;
  storeRecords?: PRReviewWorktreeRecord[];
  worktrees?: IGitWorktree[];
  branchExists?: boolean;
  worktreeDirty?: boolean;
}

class TestReviewPrByNumberCommand extends ReviewPrByNumberCommand {
  calls: string[];
  infoPrompts: { message: string; items: string[] }[] = [];
  warningPrompts: { message: string; items: string[] }[] = [];
  errorMessages: string[] = [];
  completions: { worktreePath: string; message: string }[] = [];
  upserts: any[] = [];
  removedRecordIds: string[] = [];
  worktreeAdds: { worktreePath: string; branch: string; ref: string; force: boolean }[] = [];
  resetTargets: string[] = [];
  fetchedPRs: number[] = [];

  infoResponses: (string | undefined)[] = [];
  warningResponses: (string | undefined)[] = [];

  constructor(
    private readonly options: HarnessOptions,
    store: PRReviewWorktreeStore,
    calls: string[]
  ) {
    super(configManager, mockLogService, undefined, store);
    this.calls = calls;
  }

  protected override async showInputBox(): Promise<string | undefined> {
    return this.options.input;
  }

  protected override async getGitExecutor(): Promise<GitExecutor> {
    return {
      repositoryPath: REPO_PATH,
      getRepoInfo: async () =>
        this.options.repoInfo === undefined ? { owner: 'octo', repo: 'repo' } : this.options.repoInfo,
      worktreeListDetailed: async () => this.options.worktrees ?? [],
      branchExist: async () => this.options.branchExists ?? false,
      fetchPullRequestHead: async (prNumber: number) => {
        this.calls.push(`fetchPullRequestHead ${prNumber}`);
      },
      revParse: async () => HEAD_SHA,
      worktreeAddAtRef: async (worktreePath: string, branch: string, ref: string, force = false) => {
        this.calls.push('worktreeAddAtRef');
        this.worktreeAdds.push({ worktreePath, branch, ref, force });
      },
      worktreeRemove: async (worktreePath: string) => {
        this.calls.push(`worktreeRemove ${worktreePath}`);
      },
    } as unknown as GitExecutor;
  }

  protected override createGitHubClient(): GitHubClient {
    this.calls.push('createGitHubClient');
    return {
      fetchPullRequest: async (prNumber: number) => {
        this.calls.push('fetchPullRequest');
        this.fetchedPRs.push(prNumber);
        return prData(prNumber);
      },
    } as unknown as GitHubClient;
  }

  protected override createWorktreeGitExecutor(): GitExecutor {
    return {
      isWorkdirHasChanges: async () => this.options.worktreeDirty ?? false,
      resetHardTo: async (ref: string) => {
        this.calls.push('resetHardTo');
        this.resetTargets.push(ref);
      },
    } as unknown as GitExecutor;
  }

  protected override async showCompletionActions(worktreePath: string, message: string): Promise<void> {
    this.completions.push({ worktreePath, message });
  }

  protected override async showInformationMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    this.calls.push('info');
    this.infoPrompts.push({ message, items });
    return this.infoResponses.shift();
  }

  protected override async showWarningMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    this.calls.push('warning');
    this.warningPrompts.push({ message, items });
    return this.warningResponses.shift();
  }

  protected override async showErrorMessage(message: string): Promise<string | undefined> {
    this.errorMessages.push(message);
    return undefined;
  }
}

function makeCommand(options: HarnessOptions): TestReviewPrByNumberCommand {
  const calls: string[] = [];
  const upserts: any[] = [];
  const removedRecordIds: string[] = [];

  const store = {
    upsert: async (record: unknown) => {
      calls.push('store.upsert');
      upserts.push(record);
    },
    getForRepository: async () => options.storeRecords ?? [],
    remove: async (id: string) => {
      removedRecordIds.push(id);
    },
  } as unknown as PRReviewWorktreeStore;

  const command = new TestReviewPrByNumberCommand(options, store, calls);
  command.upserts = upserts;
  command.removedRecordIds = removedRecordIds;
  return command;
}

const existingRecord = (prNumber: number): PRReviewWorktreeRecord => ({
  id: `octo/repo:${EXISTING_WORKTREE_PATH}`,
  repoKey: 'octo/repo',
  repositoryPath: REPO_PATH,
  owner: 'octo',
  repo: 'repo',
  worktreePath: EXISTING_WORKTREE_PATH,
  branchName: getReviewBranchName(prNumber),
  prNumber,
  prTitle: 'Fix the thing',
  prUrl: `https://github.com/octo/repo/pull/${prNumber}`,
  createdAt: new Date().toISOString(),
});

const existingWorktree = (prNumber: number): IGitWorktree => ({
  path: EXISTING_WORKTREE_PATH,
  branch: `refs/heads/${getReviewBranchName(prNumber)}`,
  head: HEAD_SHA,
});

describe('ReviewPrByNumberCommand', () => {
  it('creates a worktree on pr/<n>-review at the fetched head in spec order', async () => {
    const command = makeCommand({ input: '12' });
    command.infoResponses = [ACTION_REVIEW];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    const order = ['fetchPullRequest', 'info', 'fetchPullRequestHead 12', 'worktreeAddAtRef', 'store.upsert'];
    const indexes = order.map((step) => command.calls.indexOf(step));
    assert.ok(
      indexes.every((value, i) => value >= 0 && (i === 0 || value > indexes[i - 1])),
      `expected order ${order.join(' -> ')}, got: ${command.calls.join(', ')}`
    );

    assert.strictEqual(command.worktreeAdds.length, 1);
    assert.strictEqual(command.worktreeAdds[0].branch, 'pr/12-review');
    assert.strictEqual(command.worktreeAdds[0].ref, HEAD_SHA);
    assert.strictEqual(command.worktreeAdds[0].force, false);

    assert.strictEqual(command.upserts.length, 1);
    assert.strictEqual(command.upserts[0].prNumber, 12);
    assert.strictEqual(command.upserts[0].branchName, 'pr/12-review');
    assert.strictEqual(command.upserts[0].headSha, HEAD_SHA);

    assert.match(command.infoPrompts[0].message, /Review PR #12 'Fix the thing' by @alice in a new worktree\?/);
    assert.strictEqual(command.completions.length, 1);
    assert.match(command.completions[0].message, /Remove PR Review in Worktree/);
  });

  it('resolves a GitHub PR URL to the same flow as a bare number', async () => {
    const command = makeCommand({
      input: 'https://github.com/octo/repo/pull/12',
    });
    command.infoResponses = [ACTION_REVIEW];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.deepStrictEqual(command.fetchedPRs, [12]);
    assert.strictEqual(command.worktreeAdds[0]?.branch, 'pr/12-review');
  });

  it('stops before fetching commits when the confirmation is cancelled', async () => {
    const command = makeCommand({ input: '12' });
    command.infoResponses = [undefined];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.ok(!command.calls.includes('fetchPullRequestHead 12'), 'must not fetch the PR head');
    assert.deepStrictEqual(command.worktreeAdds, []);
    assert.deepStrictEqual(command.upserts, []);
  });

  it('fails fast on a non-GitHub remote without contacting GitHub', async () => {
    const command = makeCommand({ input: '12', repoInfo: null });

    await command.execute();

    assert.strictEqual(command.errorMessages.length, 1);
    assert.match(command.errorMessages[0], /GitHub repository information/);
    assert.ok(!command.calls.includes('createGitHubClient'), 'must not create a GitHub client');
  });

  it('offers open/update/recreate instead of duplicating an existing review worktree', async () => {
    const command = makeCommand({
      input: '5',
      storeRecords: [existingRecord(5)],
      worktrees: [existingWorktree(5)],
    });
    command.infoResponses = [ACTION_OPEN_EXISTING];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.strictEqual(command.infoPrompts.length, 1);
    assert.deepStrictEqual(command.infoPrompts[0].items, [
      ACTION_OPEN_EXISTING,
      ACTION_UPDATE_TO_LATEST,
      ACTION_REMOVE_AND_RECREATE,
    ]);

    assert.ok(!command.calls.includes('fetchPullRequestHead 5'), 'open existing must not fetch');
    assert.deepStrictEqual(command.worktreeAdds, []);
    assert.strictEqual(command.completions[0]?.worktreePath, EXISTING_WORKTREE_PATH);
  });

  it('refuses to update a dirty review worktree and issues no reset', async () => {
    const command = makeCommand({
      input: '5',
      storeRecords: [existingRecord(5)],
      worktrees: [existingWorktree(5)],
      worktreeDirty: true,
    });
    command.infoResponses = [ACTION_UPDATE_TO_LATEST];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.strictEqual(command.warningPrompts.length, 1);
    assert.match(command.warningPrompts[0].message, /uncommitted changes/);
    assert.deepStrictEqual(command.resetTargets, []);
    assert.ok(!command.calls.includes('fetchPullRequestHead 5'), 'must not fetch when refused');
  });

  it('updates a clean worktree by fetching in the main repo and resetting to the resolved SHA', async () => {
    const command = makeCommand({
      input: '5',
      storeRecords: [existingRecord(5)],
      worktrees: [existingWorktree(5)],
    });
    command.infoResponses = [ACTION_UPDATE_TO_LATEST];
    command.warningResponses = [ACTION_UPDATE_TO_LATEST];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.ok(command.calls.includes('fetchPullRequestHead 5'), 'must re-fetch pull/<n>/head');
    assert.deepStrictEqual(command.resetTargets, [HEAD_SHA]);
    assert.strictEqual(command.upserts[0]?.headSha, HEAD_SHA);
    assert.match(command.completions[0]?.message ?? '', /updated to/);
  });

  it('recreates the worktree with -B semantics after removal', async () => {
    const command = makeCommand({
      input: '5',
      storeRecords: [existingRecord(5)],
      worktrees: [existingWorktree(5)],
      branchExists: true,
    });
    command.infoResponses = [ACTION_REMOVE_AND_RECREATE];

    await command.execute();

    assert.deepStrictEqual(command.errorMessages, []);
    assert.ok(
      command.calls.includes(`worktreeRemove ${EXISTING_WORKTREE_PATH}`),
      'must remove the existing worktree'
    );
    assert.deepStrictEqual(command.removedRecordIds, [existingRecord(5).id]);
    assert.strictEqual(command.worktreeAdds.length, 1);
    assert.strictEqual(command.worktreeAdds[0].branch, 'pr/5-review');
    assert.strictEqual(command.worktreeAdds[0].force, true);
  });

  it('rejects invalid input without touching the repository', async () => {
    const command = makeCommand({ input: 'not-a-pr' });

    await command.execute();

    assert.strictEqual(command.errorMessages.length, 1);
    assert.match(command.errorMessages[0], /Invalid input/);
    assert.ok(!command.calls.includes('createGitHubClient'));
  });
});
