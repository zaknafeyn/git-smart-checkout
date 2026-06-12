import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  getRepositoryMismatchMessage,
  INVALID_PR_INPUT_MESSAGE,
  parsePRInput,
} from '../../commands/utils/parsePRInput';
import { GitHubClient } from '../../common/api/ghClient';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { PrCloneService } from '../../services/prCloneService';
import { PrCloneWebViewProvider } from '../../view/PrCloneWebViewProvider';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('parsePRInput', () => {
  it('parses PR numbers without repository information', () => {
    assert.deepStrictEqual(parsePRInput('123'), { prNumber: 123 });
    assert.deepStrictEqual(parsePRInput(' #123 '), { prNumber: 123 });
  });

  it('parses the owner, repository, and number from a GitHub PR URL', () => {
    assert.deepStrictEqual(
      parsePRInput('https://github.com/Other-Org/Other-Repo/pull/57/files?diff=split'),
      {
        prNumber: 57,
        owner: 'Other-Org',
        repo: 'Other-Repo',
      }
    );
  });

  it('rejects non-GitHub and malformed PR URLs', () => {
    assert.strictEqual(parsePRInput('https://example.com/owner/repo/pull/57'), null);
    assert.strictEqual(parsePRInput('https://github.com/owner/repo/issues/57'), null);
    assert.strictEqual(parsePRInput('not-a-pr'), null);
  });
});

describe('getRepositoryMismatchMessage', () => {
  it('allows number inputs and case-insensitive repository matches', () => {
    assert.strictEqual(
      getRepositoryMismatchMessage({ prNumber: 57 }, { owner: 'owner', repo: 'repo' }),
      undefined
    );
    assert.strictEqual(
      getRepositoryMismatchMessage(
        { prNumber: 57, owner: 'OWNER', repo: 'Repo' },
        { owner: 'owner', repo: 'repo' }
      ),
      undefined
    );
  });

  it('describes a repository mismatch', () => {
    assert.strictEqual(
      getRepositoryMismatchMessage(
        { prNumber: 57, owner: 'other-org', repo: 'other-repo' },
        { owner: 'current-org', repo: 'current-repo' }
      ),
      'This PR URL belongs to other-org/other-repo, but the current repository is current-org/current-repo.'
    );
  });
});

describe('PrCloneWebViewProvider PR input validation', () => {
  it('rejects a PR URL from a different repository before fetching it', async () => {
    const errors: string[] = [];
    let fetchedNumber: number | undefined;
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    (vscode.window as any).showErrorMessage = async (message: string) => {
      errors.push(message);
      return 'OK';
    };

    const ghClient = new GitHubClient('current-org', 'current-repo');
    ghClient.fetchPullRequest = async (prNumber: number) => {
      fetchedNumber = prNumber;
      throw new Error('fetch should not be called');
    };

    const provider = new PrCloneWebViewProvider(
      {} as vscode.ExtensionContext,
      mockLogService,
      {} as ConfigurationManager,
      {} as PrCloneService
    );
    (provider as any).git = {};
    (provider as any).ghClient = ghClient;

    try {
      await (provider as any).handleFetchPR(
        'https://github.com/other-org/other-repo/pull/57'
      );

      assert.strictEqual(fetchedNumber, undefined);
      assert.deepStrictEqual(errors, [
        'This PR URL belongs to other-org/other-repo, but the current repository is current-org/current-repo.',
      ]);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('uses the shared invalid-input message', async () => {
    const errors: string[] = [];
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    (vscode.window as any).showErrorMessage = async (message: string) => {
      errors.push(message);
      return 'OK';
    };

    const provider = new PrCloneWebViewProvider(
      {} as vscode.ExtensionContext,
      {} as LoggingService,
      {} as ConfigurationManager,
      {} as PrCloneService
    );
    (provider as any).git = {};
    (provider as any).ghClient = new GitHubClient('current-org', 'current-repo');

    try {
      await (provider as any).handleFetchPR('not-a-pr');
      assert.deepStrictEqual(errors, [INVALID_PR_INPUT_MESSAGE]);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });
});
