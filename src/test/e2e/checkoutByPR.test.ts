import * as assert from 'assert';
import * as vscode from 'vscode';

import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH, AUTO_STASH_MODE_POP } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';
import { GitHubPR } from '../../types/dataTypes';

import { createForkPRTestRepo, createPRTestRepo, ForkPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockConfigManager(mode: string): ConfigurationManager {
  return { get: () => ({ mode }) } as unknown as ConfigurationManager;
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

class TestableCheckoutByPRCommand extends CheckoutByPRCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly prData: GitHubPR | Error,
    autoStashService: AutoStashService
  ) {
    super(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }

  protected createGitHubClient(_owner: string, _repo: string): GitHubClient {
    const prData = this.prData;
    return {
      fetchPullRequest: async () => {
        if (prData instanceof Error) { throw prData; }
        return prData;
      },
    } as unknown as GitHubClient;
  }
}

function stubInputBox(value: string | undefined): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  (vscode.window as any).showInputBox = async () => value;
  return () => { (vscode.window as any).showInputBox = original; };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showErrorMessage = original; };
}

function stubInfoMessages(messages: string[]): () => void {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showInformationMessage = original; };
}

function withStubs(...restoreFns: Array<() => void>): () => void {
  return () => restoreFns.forEach((r) => r());
}

// ---------------------------------------------------------------------------
// Tests: same-repo PR (git operations)
// ---------------------------------------------------------------------------

describe('CheckoutByPRCommand – same-repo PR', () => {
  describe('clean working tree', () => {
    let repo: PRTestRepo;
    let restoreStubs: () => void;
    const infoMessages: string[] = [];

    before(() => {
      repo = createPRTestRepo();
      repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
      restoreStubs = withStubs(
        stubInputBox('42'),
        stubInfoMessages(infoMessages)
      );
    });

    after(() => {
      restoreStubs();
      repo.cleanup();
    });

    it('fetches and checks out the PR branch', async () => {
      const pr = makePR(repo.prBranch);
      const sut = new TestableCheckoutByPRCommand(
        repo.git,
        pr,
        new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
      );

      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.prBranch);
      assert.strictEqual(repo.fileExists('pr.txt'), true, 'PR branch file should be present');
      assert.strictEqual(repo.stashCount(), 0, 'no stash should be created for a clean workdir');
      assert.ok(infoMessages.some((m) => m.includes('42') && m.includes('Test PR title')));
    });
  });

  describe('dirty working tree – AUTO_STASH_CURRENT_BRANCH', () => {
    let repo: PRTestRepo;
    let restoreStubs: () => void;

    before(() => {
      repo = createPRTestRepo();
      repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
      restoreStubs = withStubs(stubInputBox('42'), stubInfoMessages([]));
    });

    after(() => {
      restoreStubs();
      repo.cleanup();
    });

    it('stashes changes on the source branch then checks out the PR branch', async () => {
      repo.makeChange('file1.txt', 'work in progress\n');
      const pr = makePR(repo.prBranch);
      const sut = new TestableCheckoutByPRCommand(
        repo.git,
        pr,
        new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
      );

      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.prBranch);
      assert.strictEqual(repo.fileExists('pr.txt'), true);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'PR branch should be clean');
      assert.strictEqual(repo.stashCount(), 1, 'changes should be stashed on the source branch');
      assert.ok(
        await repo.git.isStashWithMessageExists(`auto-stash-${repo.mainBranch}`),
        'stash should be named after the source branch'
      );
    });
  });

  describe('dirty working tree – AUTO_STASH_AND_POP', () => {
    let repo: PRTestRepo;
    let restoreStubs: () => void;

    before(() => {
      repo = createPRTestRepo();
      repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
      restoreStubs = withStubs(stubInputBox('42'), stubInfoMessages([]));
    });

    after(() => {
      restoreStubs();
      repo.cleanup();
    });

    it('moves changes to the PR branch by popping the stash after checkout', async () => {
      repo.makeChange('file1.txt', 'work in progress\n');
      const pr = makePR(repo.prBranch);
      const sut = new TestableCheckoutByPRCommand(
        repo.git,
        pr,
        new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_POP), mockLogService)
      );

      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.prBranch);
      assert.strictEqual(repo.readFile('file1.txt'), 'work in progress\n', 'changes should be present on PR branch');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true);
      assert.strictEqual(repo.stashCount(), 0, 'stash should be consumed after pop');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: fork PR (git operations)
// ---------------------------------------------------------------------------

describe('CheckoutByPRCommand – fork PR', () => {
  describe('clean working tree', () => {
    let repo: ForkPRTestRepo;
    let restoreStubs: () => void;

    before(() => {
      repo = createForkPRTestRepo();
      repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
      restoreStubs = withStubs(stubInputBox('99'), stubInfoMessages([]));
    });

    after(() => {
      restoreStubs();
      repo.cleanup();
    });

    it('fetches the branch from the fork remote URL and checks it out', async () => {
      const pr = makePR(repo.forkBranch, {
        number: 99,
        head: {
          ref: repo.forkBranch,
          sha: 'def456',
          repo: { full_name: 'fork-owner/repo', clone_url: repo.forkRepoPath },
        },
        base: { ref: 'main', repo: { full_name: 'owner/repo' } },
      });
      const sut = new TestableCheckoutByPRCommand(
        repo.git,
        pr,
        new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
      );

      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.forkBranch);
      assert.strictEqual(repo.fileExists('fork.txt'), true, 'fork branch file should be present');
      assert.strictEqual(repo.stashCount(), 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: input parsing
// ---------------------------------------------------------------------------

describe('CheckoutByPRCommand – input parsing', () => {
  let repo: PRTestRepo;

  before(() => {
    repo = createPRTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
  });

  after(() => { repo.cleanup(); });

  for (const input of ['42', '#42', 'https://github.com/owner/repo/pull/42']) {
    it(`accepts input "${input}" and fetches PR #42`, async () => {
      let fetchedNumber: number | undefined;
      const fakeClient = {
        fetchPullRequest: async (n: number) => {
          fetchedNumber = n;
          return makePR(repo.prBranch, { number: n });
        },
      } as unknown as GitHubClient;

      const restoreInput = stubInputBox(input);
      const restoreInfo = stubInfoMessages([]);

      class PatchedCommand extends CheckoutByPRCommand {
        protected async getGitExecutor(): Promise<GitExecutor> { return repo.git; }
        protected createGitHubClient(): GitHubClient { return fakeClient; }
      }

      try {
        await new PatchedCommand(
          makeMockConfigManager(AUTO_STASH_MODE_BRANCH),
          mockLogService,
          new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
        ).execute();
        assert.strictEqual(fetchedNumber, 42);
      } finally {
        restoreInput();
        restoreInfo();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: error & cancellation handling
// ---------------------------------------------------------------------------

describe('CheckoutByPRCommand – error handling', () => {
  let repo: PRTestRepo;

  before(() => {
    repo = createPRTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
  });

  after(() => { repo.cleanup(); });

  it('does nothing when the user cancels the input box', async () => {
    const restoreInput = stubInputBox(undefined);
    const sut = new TestableCheckoutByPRCommand(
      repo.git,
      makePR(repo.prBranch),
      new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
    );

    try {
      await sut.execute();
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch, 'branch should not change');
    } finally {
      restoreInput();
    }
  });

  it('shows an error message for invalid input', async () => {
    const errors: string[] = [];
    const restoreInput = stubInputBox('not-a-number');
    const restoreErrors = stubErrorMessages(errors);
    const sut = new TestableCheckoutByPRCommand(
      repo.git,
      makePR(repo.prBranch),
      new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
    );

    try {
      await sut.execute();
      assert.ok(errors.length > 0, 'an error message should be shown');
      assert.ok(errors[0].toLowerCase().includes('invalid'));
    } finally {
      restoreInput();
      restoreErrors();
    }
  });

  it('shows an error message when the GitHub API call fails', async () => {
    const errors: string[] = [];
    const restoreInput = stubInputBox('42');
    const restoreErrors = stubErrorMessages(errors);
    const sut = new TestableCheckoutByPRCommand(
      repo.git,
      new Error('GitHub API error: 404 Not Found'),
      new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService)
    );

    try {
      await sut.execute();
      assert.ok(errors.length > 0);
      assert.ok(errors[0].includes('42'), 'error should mention the PR number');
    } finally {
      restoreInput();
      restoreErrors();
    }
  });

  it('does not checkout when stash mode selection is cancelled', async () => {
    const restoreInput = stubInputBox('42');
    const fakeAutoStashService = {
      getAutoStashMode: async () => undefined,
      checkoutAndStashChanges: async () => { throw new Error('should not be called'); },
    } as unknown as AutoStashService;
    const sut = new TestableCheckoutByPRCommand(repo.git, makePR(repo.prBranch), fakeAutoStashService);

    try {
      await sut.execute();
      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch, 'branch should not change');
    } finally {
      restoreInput();
    }
  });
});
