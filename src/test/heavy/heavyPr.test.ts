import * as assert from 'assert';
import * as vscode from 'vscode';

import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';
import { GitHubPR } from '../../types/dataTypes';

import { createHeavyTestRepo, HeavyTestRepo } from '../e2e/helpers/gitTestRepo';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Heavy-repository coverage for checkout-by-PR (same-repo and fork). The GitHub
 * REST API is mocked; the "remote" is the heavy repo's local bare origin/fork,
 * and the working tree carries a full mixed-state WIP before the checkout.
 */

function makeMockConfigManager(mode: string): ConfigurationManager {
  return { get: () => ({ mode }) } as unknown as ConfigurationManager;
}

function makePR(headRef: string, overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 42,
    title: 'Heavy PR title',
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
    private readonly prData: GitHubPR,
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

function makeService(): AutoStashService {
  return new AutoStashService(makeMockConfigManager(AUTO_STASH_MODE_BRANCH), mockLogService);
}

describe('Heavy repo — checkout by PR (same repo)', () => {
  let repo: HeavyTestRepo;
  let restoreInput: () => void;
  let restoreInfo: () => void;

  before(() => {
    repo = createHeavyTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'heavy-repo', host: 'github.com' });
    restoreInput = stubInputBox('42');
    restoreInfo = stubInfoMessages([]);
  });

  after(() => {
    restoreInfo();
    restoreInput();
    repo.cleanup();
  });

  it('stashes the mixed WIP on the source branch and checks out the fetched PR branch', async () => {
    repo.seedComplexWorkingState();

    await new TestableCheckoutByPRCommand(repo.git, makePR(repo.prBranch), makeService()).execute();

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.prBranch);
    assert.strictEqual(repo.fileExists('src/features/prFeature.ts'), true, 'PR branch content present');
    assert.strictEqual(await repo.git.isWorkdirHasChanges(), false, 'PR branch is clean');
    assert.strictEqual(repo.stashCount(), 1, 'WIP stashed on the source branch');
    assert.strictEqual(
      await repo.git.isStashWithMessageExists(`auto-stash-${repo.mainBranch}`),
      true,
      'stash named after the source branch'
    );
  });
});

describe('Heavy repo — checkout by PR (fork)', () => {
  let repo: HeavyTestRepo;
  let restoreInput: () => void;
  let restoreInfo: () => void;

  before(() => {
    repo = createHeavyTestRepo();
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'heavy-repo', host: 'github.com' });
    restoreInput = stubInputBox('99');
    restoreInfo = stubInfoMessages([]);
  });

  after(() => {
    restoreInfo();
    restoreInput();
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

    await new TestableCheckoutByPRCommand(repo.git, pr, makeService()).execute();

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.forkBranch);
    assert.strictEqual(repo.fileExists('src/features/forkFeature.ts'), true, 'fork branch content present');
  });
});
