import * as assert from 'assert';
import * as vscode from 'vscode';

import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { CheckoutPreviousCommand } from '../../commands/checkoutPreviousCommand';
import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import {
  WORKTREE_CONFLICT_CREATE_BRANCH,
  WORKTREE_CONFLICT_OPEN_CURRENT,
  WORKTREE_CONFLICT_OPEN_NEW,
} from '../../commands/utils/worktreeBranchConflict';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';
import { GitHubPR } from '../../types/dataTypes';

import {
  createPRWorktreeTestRepo,
  createTestRepo,
  createWorktreeTestRepo,
  PRWorktreeTestRepo,
  TestRepo,
  WorktreeTestRepo,
} from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMockConfig(mode = AUTO_STASH_MODE_BRANCH): ConfigurationManager {
  return {
    get: () => ({ mode, useFastBranchList: false }),
    isPreferred: () => false,
    cleanupMissing: () => {},
  } as unknown as ConfigurationManager;
}

function makeRef(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

function makeAutoStash(): AutoStashService {
  return new AutoStashService(makeMockConfig(), mockLogService);
}

function makePR(headRef: string, overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 42,
    title: 'Test PR',
    body: '',
    head: { ref: headRef, sha: 'abc123', repo: { full_name: 'owner/repo', clone_url: '' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    html_url: 'https://github.com/owner/repo/pull/42',
    labels: [],
    assignees: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubInfoMessage(
  ...responses: Array<string | undefined>
): { calls: Array<{ message: string; items: string[] }>; restore: () => void } {
  const calls: Array<{ message: string; items: string[] }> = [];
  const queue = [...responses];
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (msg: string, ...items: string[]) => {
    calls.push({ message: msg, items });
    return queue.shift();
  };
  return { calls, restore: () => { (vscode.window as any).showInformationMessage = original; } };
}

function stubInputBox(
  ...answers: Array<string | undefined>
): { restore: () => void } {
  const queue = [...answers];
  const original = vscode.window.showInputBox.bind(vscode.window);
  (vscode.window as any).showInputBox = async () => queue.shift();
  return { restore: () => { (vscode.window as any).showInputBox = original; } };
}

function stubErrorMessages(messages: string[]): { restore: () => void } {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (msg: string) => {
    messages.push(msg);
    return 'OK';
  };
  return { restore: () => { (vscode.window as any).showErrorMessage = original; } };
}

function stubExecuteCommand(): {
  calls: Array<{ command: string; args: unknown[] }>;
  restore: () => void;
} {
  const calls: Array<{ command: string; args: unknown[] }> = [];
  const original = vscode.commands.executeCommand.bind(vscode.commands);
  (vscode.commands as any).executeCommand = async (cmd: string, ...args: unknown[]) => {
    calls.push({ command: cmd, args });
  };
  return { calls, restore: () => { (vscode.commands as any).executeCommand = original; } };
}

// ---------------------------------------------------------------------------
// Testable command classes
// ---------------------------------------------------------------------------

class TestableCheckoutToCommand extends CheckoutToCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly targetRef: IGitRef,
    autoStashService: AutoStashService
  ) {
    super(makeMockConfig(), mockLogService, autoStashService);
  }

  protected async getGitExecutor(_p?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }

  async getSelectedOption(
    _git: GitExecutor
  ): Promise<{ currentBranch: string; selection: string; branchList: IGitRef[] }> {
    const currentBranch = await this.testGit.getCurrentBranch();
    return { currentBranch, selection: this.targetRef.fullName, branchList: [this.targetRef] };
  }

  async getTargetBranch(
    _git: GitExecutor,
    _selection: string,
    _list: IGitRef[]
  ): Promise<IGitRef> {
    return this.targetRef;
  }
}

class TestableCheckoutPreviousCommand extends CheckoutPreviousCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly mockedPreviousBranch: IGitRef,
    autoStashService: AutoStashService
  ) {
    super(mockLogService, autoStashService);
    // Shadow getPreviousBranch on the instance so the command always receives the
    // controlled branch regardless of reflog state, which can vary between tests.
    (this.testGit as any).getPreviousBranch = async () => this.mockedPreviousBranch;
  }

  protected async getGitExecutor(_p?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }
}

class TestableCheckoutByPRCommand extends CheckoutByPRCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly prData: GitHubPR | Error,
    autoStashService: AutoStashService
  ) {
    super(makeMockConfig(), mockLogService, autoStashService);
  }

  protected async getGitExecutor(_p?: VscodeGitProvider): Promise<GitExecutor> {
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

// ---------------------------------------------------------------------------
// CheckoutToCommand — no-conflict baseline
// ---------------------------------------------------------------------------

describe('CheckoutToCommand — no worktree conflict', () => {
  let repo: TestRepo;

  before(() => { repo = createTestRepo(); });
  after(() => { repo.cleanup(); });

  it('proceeds normally when the target branch has no worktree', async () => {
    const targetRef = makeRef(repo.featureBranch);
    const infoStub = stubInfoMessage();
    const sut = new TestableCheckoutToCommand(repo.git, targetRef, makeAutoStash());

    try {
      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(infoStub.calls.length, 0, 'no conflict dialog should appear');
    } finally {
      infoStub.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// CheckoutToCommand — worktree conflict scenarios
// ---------------------------------------------------------------------------

describe('CheckoutToCommand — worktree conflict', () => {
  let repo: WorktreeTestRepo;

  before(() => { repo = createWorktreeTestRepo(); });
  after(() => { repo.cleanup(); });

  function makeSut(): TestableCheckoutToCommand {
    return new TestableCheckoutToCommand(
      repo.git,
      makeRef(repo.worktreeBranch),
      makeAutoStash()
    );
  }

  it('dismissing the conflict dialog cancels checkout', async () => {
    const infoStub = stubInfoMessage(undefined);
    const errors: string[] = [];
    const errStub = stubErrorMessages(errors);

    try {
      await makeSut().execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(infoStub.calls.length, 1);
      assert.ok(infoStub.calls[0].message.includes(repo.worktreeBranch));
      assert.deepStrictEqual(errors, []);
    } finally {
      infoStub.restore();
      errStub.restore();
    }
  });

  it('Open in Current Window: opens worktree folder in current window, no checkout', async () => {
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_CURRENT);
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut().execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], false);
    } finally {
      infoStub.restore();
      cmdStub.restore();
    }
  });

  it('Open in New Window: opens worktree folder in new window, no checkout', async () => {
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_NEW);
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut().execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], true);
    } finally {
      infoStub.restore();
      cmdStub.restore();
    }
  });

  it('Create New Branch: creates branch at target commit and checks it out', async () => {
    const newBranchName = 'checkout-to-new-from-conflict';
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox(newBranchName);

    try {
      await makeSut().execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), newBranchName);
    } finally {
      infoStub.restore();
      inputStub.restore();
      repo.exec(`git checkout ${repo.mainBranch}`);
    }
  });

  it('Create New Branch then cancel name input: no checkout', async () => {
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox(undefined);

    try {
      await makeSut().execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
    } finally {
      infoStub.restore();
      inputStub.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// CheckoutPreviousCommand — no-conflict baseline
// ---------------------------------------------------------------------------

describe('CheckoutPreviousCommand — no worktree conflict', () => {
  it('proceeds normally when the previous branch has no worktree', async () => {
    const repo = createTestRepo();
    const infoStub = stubInfoMessage();

    try {
      // Point previous branch at the feature branch which has no worktree.
      const sut = new TestableCheckoutPreviousCommand(
        repo.git,
        makeRef(repo.featureBranch),
        makeAutoStash()
      );
      await sut.execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      // The success message "Switched to previous branch: ..." is expected.
      // Assert that no conflict dialog (which mentions the worktree path) was shown.
      assert.ok(
        !infoStub.calls.some((c) => c.message.includes('already checked out in another worktree')),
        'no conflict dialog should appear'
      );
    } finally {
      infoStub.restore();
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// CheckoutPreviousCommand — worktree conflict scenarios
//
// Each test creates its own WorktreeTestRepo so that the getPreviousBranch
// mock is wired fresh and no shared reflog state leaks between tests.
// ---------------------------------------------------------------------------

describe('CheckoutPreviousCommand — worktree conflict', () => {
  function makeSut(repo: WorktreeTestRepo): TestableCheckoutPreviousCommand {
    return new TestableCheckoutPreviousCommand(
      repo.git,
      makeRef(repo.worktreeBranch),
      makeAutoStash()
    );
  }

  it('dismissing the conflict dialog cancels checkout', async () => {
    const repo = createWorktreeTestRepo();
    const infoStub = stubInfoMessage(undefined);
    const errors: string[] = [];
    const errStub = stubErrorMessages(errors);

    try {
      await makeSut(repo).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(infoStub.calls.length, 1);
      assert.ok(infoStub.calls[0].message.includes(repo.worktreeBranch));
      assert.deepStrictEqual(errors, []);
    } finally {
      infoStub.restore();
      errStub.restore();
      repo.cleanup();
    }
  });

  it('Open in Current Window: opens worktree folder in current window, no checkout', async () => {
    const repo = createWorktreeTestRepo();
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_CURRENT);
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut(repo).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], false);
    } finally {
      infoStub.restore();
      cmdStub.restore();
      repo.cleanup();
    }
  });

  it('Open in New Window: opens worktree folder in new window, no checkout', async () => {
    const repo = createWorktreeTestRepo();
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_NEW);
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut(repo).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], true);
    } finally {
      infoStub.restore();
      cmdStub.restore();
      repo.cleanup();
    }
  });

  it('Create New Branch: creates branch at target commit and checks it out', async () => {
    const repo = createWorktreeTestRepo();
    const newBranchName = 'prev-new-from-conflict';
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox(newBranchName);

    try {
      await makeSut(repo).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), newBranchName);
    } finally {
      infoStub.restore();
      inputStub.restore();
      repo.cleanup();
    }
  });

  it('Create New Branch then cancel name input: no checkout', async () => {
    const repo = createWorktreeTestRepo();
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox(undefined);

    try {
      await makeSut(repo).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
    } finally {
      infoStub.restore();
      inputStub.restore();
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// CheckoutByPRCommand — worktree conflict scenarios
// ---------------------------------------------------------------------------

describe('CheckoutByPRCommand — worktree conflict', () => {
  let repo: PRWorktreeTestRepo;

  before(() => {
    repo = createPRWorktreeTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });
  });

  after(() => { repo.cleanup(); });

  function makeSut(pr: GitHubPR): TestableCheckoutByPRCommand {
    return new TestableCheckoutByPRCommand(repo.git, pr, makeAutoStash());
  }

  it('proceeds normally when PR branch has no worktree (covered by checkoutByPR.test.ts)', () => {
    // The no-conflict path is exercised by the existing checkoutByPR.test.ts suite.
    // This placeholder keeps the test structure symmetric across all three commands.
    assert.ok(true);
  });

  it('dismissing the conflict dialog cancels checkout', async () => {
    const pr = makePR(repo.prBranch);
    const infoStub = stubInfoMessage(undefined);
    const inputStub = stubInputBox('42');
    const errors: string[] = [];
    const errStub = stubErrorMessages(errors);

    try {
      await makeSut(pr).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.ok(infoStub.calls.some((c) => c.message.includes(repo.prBranch)));
      assert.deepStrictEqual(errors, []);
    } finally {
      infoStub.restore();
      inputStub.restore();
      errStub.restore();
    }
  });

  it('Open in Current Window: opens worktree folder in current window, no checkout', async () => {
    const pr = makePR(repo.prBranch);
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_CURRENT);
    const inputStub = stubInputBox('42');
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut(pr).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], false);
    } finally {
      infoStub.restore();
      inputStub.restore();
      cmdStub.restore();
    }
  });

  it('Open in New Window: opens worktree folder in new window, no checkout', async () => {
    const pr = makePR(repo.prBranch);
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_OPEN_NEW);
    const inputStub = stubInputBox('42');
    const cmdStub = stubExecuteCommand();

    try {
      await makeSut(pr).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
      assert.strictEqual(cmdStub.calls.length, 1);
      assert.strictEqual(cmdStub.calls[0].command, 'vscode.openFolder');
      assert.strictEqual(cmdStub.calls[0].args[1], true);
    } finally {
      infoStub.restore();
      inputStub.restore();
      cmdStub.restore();
    }
  });

  it('Create New Branch: creates branch at PR branch commit and checks it out', async () => {
    const pr = makePR(repo.prBranch);
    const newBranchName = 'pr-new-from-conflict';
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox('42', newBranchName);

    try {
      await makeSut(pr).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), newBranchName);
    } finally {
      infoStub.restore();
      inputStub.restore();
      repo.exec(`git checkout ${repo.mainBranch}`);
    }
  });

  it('Create New Branch then cancel name input: no checkout', async () => {
    const pr = makePR(repo.prBranch);
    const infoStub = stubInfoMessage(WORKTREE_CONFLICT_CREATE_BRANCH);
    const inputStub = stubInputBox('42', undefined);

    try {
      await makeSut(pr).execute();

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.mainBranch);
    } finally {
      infoStub.restore();
      inputStub.restore();
    }
  });
});
