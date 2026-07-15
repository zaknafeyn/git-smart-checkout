import * as assert from 'assert';
import { execSync } from 'child_process';
import * as vscode from 'vscode';

import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';
import { GitHubPR } from '../../types/dataTypes';
import { clearRememberedRemotes } from '../../common/git/remoteResolver';

import { createTwoRemoteTestRepo, TwoRemoteTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockConfigManager(defaultRemote?: string): ConfigurationManager {
  return { get: () => ({ mode: AUTO_STASH_MODE_BRANCH, defaultRemote }) } as unknown as ConfigurationManager;
}

function makePR(headRef: string): GitHubPR {
  return {
    number: 42,
    title: 'Test PR title',
    body: '',
    head: { ref: headRef, sha: 'abc123', repo: { full_name: 'owner/repo', clone_url: '' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    html_url: 'https://github.com/owner/repo/pull/42',
    labels: [],
    assignees: [],
  };
}

class TestableCheckoutByPRCommand extends CheckoutByPRCommand {
  constructor(
    private readonly testGit: GitExecutor,
    private readonly prData: GitHubPR,
    autoStashService: AutoStashService,
    configManager: ConfigurationManager
  ) {
    super(configManager, mockLogService, autoStashService);
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

function stubInputBox(value: string | undefined): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  (vscode.window as any).showInputBox = async () => value;
  return () => { (vscode.window as any).showInputBox = original; };
}

function stubInfoMessages(messages: string[]): () => void {
  const original = vscode.window.showInformationMessage.bind(vscode.window);
  (vscode.window as any).showInformationMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showInformationMessage = original; };
}

function stubShowQuickPick(
  pick: (items: readonly vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined
): { calls: number; restore: () => void } {
  const original = vscode.window.showQuickPick.bind(vscode.window);
  const state = { calls: 0 };

  (vscode.window as any).showQuickPick = async (items: readonly vscode.QuickPickItem[]) => {
    state.calls += 1;
    return pick(items);
  };

  return {
    get calls() {
      return state.calls;
    },
    restore() {
      (vscode.window as any).showQuickPick = original;
    },
  };
}

function withStubs(...restoreFns: Array<() => void>): () => void {
  return () => restoreFns.forEach((r) => r());
}

function upstreamOf(repo: TwoRemoteTestRepo, branch: string): string {
  return execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: repo.repoPath })
    .toString()
    .trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-remote resolution — checkout by PR', () => {
  let repo: TwoRemoteTestRepo;
  let restoreStubs: () => void;

  beforeEach(() => {
    repo = createTwoRemoteTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo' });
    clearRememberedRemotes();
  });

  afterEach(() => {
    restoreStubs?.();
    repo.cleanup();
  });

  it('prompts for a remote when the branch is ambiguous across two remotes, and checks out from the chosen one', async () => {
    const quickPick = stubShowQuickPick((items) => items.find((i) => i.label === 'upstream'));
    restoreStubs = withStubs(stubInputBox('42'), stubInfoMessages([]), quickPick.restore);

    const pr = makePR(repo.remoteOnlyBranch);
    const sut = new TestableCheckoutByPRCommand(
      repo.git,
      pr,
      new AutoStashService(makeMockConfigManager(), mockLogService),
      makeMockConfigManager()
    );

    await sut.execute();

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.remoteOnlyBranch);
    assert.strictEqual(quickPick.calls, 1, 'user should be prompted exactly once to disambiguate the remote');
    assert.strictEqual(
      upstreamOf(repo, repo.remoteOnlyBranch),
      `upstream/${repo.remoteOnlyBranch}`,
      'the local branch must track the remote the user actually picked, not silently default to origin'
    );
  });

  it('honors git-smart-checkout.defaultRemote and skips the QuickPick entirely', async () => {
    const quickPick = stubShowQuickPick(() => { throw new Error('should not prompt when defaultRemote is set'); });
    restoreStubs = withStubs(stubInputBox('42'), stubInfoMessages([]), quickPick.restore);

    const pr = makePR(repo.remoteOnlyBranch);
    const sut = new TestableCheckoutByPRCommand(
      repo.git,
      pr,
      new AutoStashService(makeMockConfigManager('upstream'), mockLogService),
      makeMockConfigManager('upstream')
    );

    await sut.execute();

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.remoteOnlyBranch);
    assert.strictEqual(quickPick.calls, 0);
    assert.strictEqual(upstreamOf(repo, repo.remoteOnlyBranch), `upstream/${repo.remoteOnlyBranch}`);
  });

  it('remembers the picked remote for the rest of the session and does not re-prompt', async () => {
    const quickPick = stubShowQuickPick((items) => items.find((i) => i.label === 'upstream'));
    restoreStubs = withStubs(stubInputBox('42'), stubInfoMessages([]), quickPick.restore);

    const cfg = makeMockConfigManager();
    const pr = makePR(repo.remoteOnlyBranch);

    await new TestableCheckoutByPRCommand(
      repo.git,
      pr,
      new AutoStashService(cfg, mockLogService),
      cfg
    ).execute();

    assert.strictEqual(quickPick.calls, 1);

    // Second command against the same repo path should reuse the remembered pick.
    repo.exec('git checkout main');
    repo.exec(`git branch -D ${repo.remoteOnlyBranch}`);

    await new TestableCheckoutByPRCommand(
      repo.git,
      pr,
      new AutoStashService(cfg, mockLogService),
      cfg
    ).execute();

    assert.strictEqual(quickPick.calls, 1, 'second invocation for the same repo should not re-prompt');
    assert.strictEqual(upstreamOf(repo, repo.remoteOnlyBranch), `upstream/${repo.remoteOnlyBranch}`);
  });
});
