import * as assert from 'assert';
import * as vscode from 'vscode';

import { CheckoutByPRCommand } from '../../commands/checkoutByPRCommand';
import { resolveGitHubHostConfig } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { AutoStashService } from '../../services/autoStashService';

import { createPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockConfigManager(githubEnterpriseBaseUrl: string): ConfigurationManager {
  return {
    get: () => ({ mode: AUTO_STASH_MODE_BRANCH, githubEnterpriseBaseUrl }),
  } as unknown as ConfigurationManager;
}

/** Captures the resolved host config for the last `createGitHubClient` call instead of hitting the network. */
class HostConfigCapturingCheckoutByPRCommand extends CheckoutByPRCommand {
  lastHostConfig?: { apiBaseUrl: string; webBaseUrl: string };
  lastRepoInfo?: { owner: string; repo: string; host: string };

  constructor(
    private readonly testGit: GitExecutor,
    configManager: ConfigurationManager,
    autoStashService: AutoStashService
  ) {
    super(configManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return this.testGit;
  }

  protected createGitHubClient(owner: string, repo: string, host: string) {
    this.lastRepoInfo = { owner, repo, host };
    this.lastHostConfig = resolveGitHubHostConfig(host, this.configManagerRef.get().githubEnterpriseBaseUrl);
    return {
      fetchPullRequest: async () => {
        throw new Error('network access not expected in this test');
      },
    } as unknown as ReturnType<CheckoutByPRCommand['createGitHubClient']>;
  }

  // Re-expose the private base-class field under a distinct name for the test to read the same
  // config the real production code path would use.
  private get configManagerRef(): ConfigurationManager {
    return (this as unknown as { configManager: ConfigurationManager }).configManager;
  }
}

function stubInputBox(value: string | undefined): () => void {
  const original = vscode.window.showInputBox.bind(vscode.window);
  (vscode.window as any).showInputBox = async () => value;
  return () => { (vscode.window as any).showInputBox = original; };
}

function stubErrorMessages(): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async () => 'OK';
  return () => { (vscode.window as any).showErrorMessage = original; };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHub Enterprise provider — repo info and client host routing', () => {
  let repo: PRTestRepo;
  let restoreStubs: () => void;

  before(() => {
    repo = createPRTestRepo();
  });

  after(() => {
    repo.cleanup();
  });

  afterEach(() => {
    restoreStubs?.();
  });

  it('resolves an Enterprise host from the remote URL and routes the GitHub client to <baseUrl>/api/v3', async () => {
    const enterpriseBaseUrl = 'https://ghe.corp.example';
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'ghe.corp.example' });

    const configManager = makeMockConfigManager(enterpriseBaseUrl);
    const sut = new HostConfigCapturingCheckoutByPRCommand(
      repo.git,
      configManager,
      new AutoStashService(configManager, mockLogService)
    );
    restoreStubs = (() => {
      const restoreInput = stubInputBox('42');
      const restoreError = stubErrorMessages();
      return () => { restoreInput(); restoreError(); };
    })();

    await sut.execute();

    assert.deepStrictEqual(sut.lastRepoInfo, { owner: 'owner', repo: 'test-repo', host: 'ghe.corp.example' });
    assert.deepStrictEqual(sut.lastHostConfig, {
      apiBaseUrl: 'https://ghe.corp.example/api/v3',
      webBaseUrl: 'https://ghe.corp.example',
    });
  });

  it('falls back to github.com routing when no Enterprise base URL is configured', async () => {
    repo.git.getRepoInfo = async () => ({ owner: 'owner', repo: 'test-repo', host: 'github.com' });

    const configManager = makeMockConfigManager('');
    const sut = new HostConfigCapturingCheckoutByPRCommand(
      repo.git,
      configManager,
      new AutoStashService(configManager, mockLogService)
    );
    restoreStubs = (() => {
      const restoreInput = stubInputBox('42');
      const restoreError = stubErrorMessages();
      return () => { restoreInput(); restoreError(); };
    })();

    await sut.execute();

    assert.deepStrictEqual(sut.lastHostConfig, {
      apiBaseUrl: 'https://api.github.com',
      webBaseUrl: 'https://github.com',
    });
  });
});
