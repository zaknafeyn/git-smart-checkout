import * as assert from 'assert';
import { ExtensionContext, ExtensionMode } from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PrCloneService } from '../../services/prCloneService';
import { PrCloneServiceBase } from '../../services/prCloneServiceBase';
import { PrCloneWebViewProvider } from '../../view/PrCloneWebViewProvider';
import { WebviewCommand } from '../../types/webviewCommands';
import { mockLogService } from '../e2e/helpers/mockLogService';

const context = {
  extensionMode: ExtensionMode.Test,
} as ExtensionContext;

const configurationManager = {} as ConfigurationManager;

function createGit(repositoryPath: string): GitExecutor {
  return new GitExecutor(repositoryPath, mockLogService);
}

function getCleanUpActionCount(service: PrCloneServiceBase): number {
  return (
    service as unknown as {
      cleanUpActionEnd: (() => void)[];
    }
  ).cleanUpActionEnd.length;
}

describe('PrCloneService re-initialization', () => {
  it('keeps services when repository identity is unchanged', () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);
    const git = createGit('/repo/a');
    const ghClient = new GitHubClient('owner', 'repo');
    let changes = 0;
    service.onDidChangeRepository(() => changes++);

    service.init(git, ghClient);
    const tempWorktreeService = service.TempWorktreeService;
    const inPlaceService = service.InPlaceService;

    service.init(createGit('/repo/a'), new GitHubClient('owner', 'repo'));

    assert.strictEqual(service.TempWorktreeService, tempWorktreeService);
    assert.strictEqual(service.InPlaceService, inPlaceService);
    assert.strictEqual(service.git, git);
    assert.strictEqual(service.ghClient, ghClient);
    assert.strictEqual(changes, 1);

    service.dispose();
  });

  it('disposes and rebuilds services when the repository path changes', () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);
    service.init(createGit('/repo/a'), new GitHubClient('owner', 'repo-a'));

    const oldTempWorktreeService = service.TempWorktreeService;
    const oldInPlaceService = service.InPlaceService;
    let tempDisposeCount = 0;
    let inPlaceDisposeCount = 0;
    oldTempWorktreeService.dispose = () => tempDisposeCount++;
    oldInPlaceService.dispose = () => inPlaceDisposeCount++;

    const nextGit = createGit('/repo/b');
    const nextClient = new GitHubClient('owner', 'repo-b');
    service.init(nextGit, nextClient);

    assert.strictEqual(tempDisposeCount, 1);
    assert.strictEqual(inPlaceDisposeCount, 1);
    assert.notStrictEqual(service.TempWorktreeService, oldTempWorktreeService);
    assert.notStrictEqual(service.InPlaceService, oldInPlaceService);
    assert.strictEqual(service.git, nextGit);
    assert.strictEqual(service.ghClient, nextClient);

    service.dispose();
  });

  it('rebuilds services when the GitHub repository changes at the same path', () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);
    const git = createGit('/repo/a');
    service.init(git, new GitHubClient('owner', 'old-repo'));
    const oldTempWorktreeService = service.TempWorktreeService;

    const nextClient = new GitHubClient('other-owner', 'new-repo');
    service.init(git, nextClient);

    assert.notStrictEqual(service.TempWorktreeService, oldTempWorktreeService);
    assert.strictEqual(service.ghClient, nextClient);

    service.dispose();
  });

  it('re-registers cleanup actions on rebuilt services', () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);
    service.init(createGit('/repo/a'), new GitHubClient('owner', 'repo-a'));
    service.addCleanUpActions({ cleanUpActionEnd: () => {} });

    service.init(createGit('/repo/b'), new GitHubClient('owner', 'repo-b'));

    assert.strictEqual(getCleanUpActionCount(service.TempWorktreeService), 1);
    assert.strictEqual(getCleanUpActionCount(service.InPlaceService), 1);

    service.dispose();
  });
});

describe('PrCloneService.abortClonePR guard', () => {
  it('resolves without throwing when called before init() (no active clone)', async () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);

    await assert.doesNotReject(() => service.abortClonePR());

    service.dispose();
  });
});

describe('PrCloneWebViewProvider repository refresh', () => {
  it('clears stale PR data and posts updated repository info after re-init', () => {
    const service = new PrCloneService(context, mockLogService, configurationManager);
    const provider = new PrCloneWebViewProvider(
      context,
      mockLogService,
      configurationManager,
      service
    );
    const messages: { command: WebviewCommand; repoInfo?: { owner: string; repo: string } }[] = [];

    (
      provider as unknown as {
        webviewView: {
          webview: {
            postMessage: (message: {
              command: WebviewCommand;
              repoInfo?: { owner: string; repo: string };
            }) => Promise<boolean>;
          };
        };
        currentPrData: object;
      }
    ).webviewView = {
      webview: {
        postMessage: async (message) => {
          messages.push(message);
          return true;
        },
      },
    };

    service.init(createGit('/repo/a'), new GitHubClient('owner-a', 'repo-a'));
    (
      provider as unknown as {
        currentPrData: object;
      }
    ).currentPrData = {};
    service.init(createGit('/repo/b'), new GitHubClient('owner-b', 'repo-b'));

    const repoInfoMessages = messages.filter(
      (message) => message.command === WebviewCommand.UPDATE_REPO_INFO
    );
    assert.deepStrictEqual(repoInfoMessages.at(-1)?.repoInfo, {
      owner: 'owner-b',
      repo: 'repo-b',
    });
    assert.strictEqual(
      (
        provider as unknown as {
          currentPrData?: object;
        }
      ).currentPrData,
      undefined
    );

    provider.dispose();
  });
});
