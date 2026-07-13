import * as assert from 'assert';
import * as vscode from 'vscode';
import { type Webview } from 'vscode';

import { GitHubApiError, GitHubClient } from '../../common/api/ghClient';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PrCloneService } from '../../services/prCloneService';
import { GitHubPR } from '../../types/dataTypes';
import { WebviewCommand } from '../../types/webviewCommands';
import {
  getFetchPRErrorNotification,
  postFetchPRError,
  PrCloneWebViewProvider,
} from '../../view/PrCloneWebViewProvider';
import { mockLogService } from '../e2e/helpers/mockLogService';

function createPullRequest(number = 404): GitHubPR {
  return {
    number,
    title: 'Example PR',
    body: 'Body',
    head: {
      ref: 'feature/example',
      sha: 'abc123',
    },
    base: {
      ref: 'main',
    },
    html_url: `https://github.com/owner/repo/pull/${number}`,
    labels: [],
    assignees: [],
  };
}

function createPrCloneService(
  ghClient: GitHubClient,
  git: Record<string, unknown> = {}
): PrCloneService {
  return {
    onDidChangeRepository: () => ({ dispose: () => {} }),
    git,
    ghClient,
  } as unknown as PrCloneService;
}

describe('postFetchPRError', () => {
  it('posts the fetch failure to the PR webview', async () => {
    const messages: unknown[] = [];
    const webview = {
      postMessage: async (message: unknown) => {
        messages.push(message);
        return true;
      },
    } as Pick<Webview, 'postMessage'>;

    const posted = await postFetchPRError(webview, new Error('PR not found'));

    assert.strictEqual(posted, true);
    assert.deepStrictEqual(messages, [
      {
        command: WebviewCommand.FETCH_PR_ERROR,
        message: 'Error: PR not found',
      },
    ]);
  });

  it('can post the user-facing fetch failure message', async () => {
    const messages: unknown[] = [];
    const webview = {
      postMessage: async (message: unknown) => {
        messages.push(message);
        return true;
      },
    } as Pick<Webview, 'postMessage'>;

    await postFetchPRError(webview, new Error('raw details'), 'PR #404 does not exist.');

    assert.deepStrictEqual(messages, [
      {
        command: WebviewCommand.FETCH_PR_ERROR,
        message: 'PR #404 does not exist.',
      },
    ]);
  });
});

describe('getFetchPRErrorNotification', () => {
  const ghClient = { owner: 'owner', repo: 'repo' };

  it('shows a clear message when the selected PR does not exist', () => {
    const error = new GitHubApiError({
      endpoint: '/repos/owner/repo/pulls/404',
      method: 'GET',
      url: 'https://api.github.com/repos/owner/repo/pulls/404',
      statusCode: 404,
      statusMessage: 'Not Found',
      responseBody:
        '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/pulls/pulls#get-a-pull-request","status":"404"}',
    });

    const notification = getFetchPRErrorNotification(404, ghClient, error);

    assert.strictEqual(notification.message, 'PR #404 does not exist.');
    assert.match(notification.detail, /^Exact error:\nGitHub API error: 404 Not Found/m);
    assert.match(
      notification.detail,
      /GET https:\/\/api\.github\.com\/repos\/owner\/repo\/pulls\/404/
    );
    assert.match(notification.detail, /Status: 404 Not Found/);
    assert.match(notification.detail, /"message":"Not Found"/);
  });

  it('uses a generic message for other fetch failures and preserves details', () => {
    const error = new Error('network timeout');

    const notification = getFetchPRErrorNotification(42, ghClient, error);

    assert.strictEqual(notification.message, 'Something went wrong');
    assert.match(notification.detail, /^Exact error:\nnetwork timeout/m);
    assert.match(
      notification.detail,
      /GET https:\/\/api\.github\.com\/repos\/owner\/repo\/pulls\/42/
    );
    assert.match(notification.detail, /network timeout/);
  });
});

describe('PrCloneWebViewProvider fetch error handling', () => {
  it('shows fetch failures as floating notifications with expandable details', async () => {
    const messages: unknown[] = [];
    const showErrorCalls: unknown[][] = [];
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    (vscode.window as any).showErrorMessage = async (...args: unknown[]) => {
      showErrorCalls.push(args);
      return 'OK';
    };

    const ghClient = new GitHubClient('owner', 'repo');
    ghClient.fetchPullRequest = async () => {
      throw new GitHubApiError({
        endpoint: '/repos/owner/repo/pulls/404',
        method: 'GET',
        url: 'https://api.github.com/repos/owner/repo/pulls/404',
        statusCode: 404,
        statusMessage: 'Not Found',
        responseBody: '{"message":"Not Found","status":"404"}',
      });
    };

    const provider = new PrCloneWebViewProvider(
      {} as vscode.ExtensionContext,
      mockLogService,
      {} as ConfigurationManager,
      createPrCloneService(ghClient)
    );
    (provider as any).webviewView = {
      webview: {
        postMessage: async (message: unknown) => {
          messages.push(message);
          return true;
        },
      },
    };

    try {
      await (provider as any).handleFetchPR('404');

      assert.deepStrictEqual(messages, [
        {
          command: WebviewCommand.FETCH_PR_ERROR,
          message: 'PR #404 does not exist.',
        },
      ]);
      assert.strictEqual(showErrorCalls.length, 1);
      assert.strictEqual(showErrorCalls[0][0], 'PR #404 does not exist.');
      assert.deepStrictEqual(showErrorCalls[0][2], 'OK');

      const options = showErrorCalls[0][1] as { modal?: boolean; detail?: string };
      assert.strictEqual(options.modal, undefined);
      assert.match(options.detail ?? '', /^Exact error:\nGitHub API error: 404 Not Found/m);
      assert.match(options.detail ?? '', /"message":"Not Found"/);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });

  it('posts FETCH_PR_ERROR when invalid default branch prevents showing fetched PR data', async () => {
    const messages: unknown[] = [];
    const errors: string[] = [];
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    (vscode.window as any).showErrorMessage = async (message: string) => {
      errors.push(message);
      return 'OK';
    };

    const ghClient = new GitHubClient('owner', 'repo');
    ghClient.fetchPullRequest = async () => createPullRequest(42);
    ghClient.fetchPullRequestCommits = async () => [];
    ghClient.fetchCommitsDetails = async () => [];
    ghClient.fetchPullRequestTemplate = async () => undefined;

    const provider = new PrCloneWebViewProvider(
      {} as vscode.ExtensionContext,
      mockLogService,
      {
        get: () => ({
          defaultTargetBranch: 'release/missing',
          prBranchPrefix: '',
        }),
      } as unknown as ConfigurationManager,
      createPrCloneService(ghClient, {
        fetchPullRequestHead: async () => {},
        getAllRefListExtended: async () => [{ name: 'main', remote: false, isTag: false }],
      })
    );
    (provider as any).webviewView = {
      webview: {
        postMessage: async (message: unknown) => {
          messages.push(message);
          return true;
        },
      },
    };

    try {
      await (provider as any).handleFetchPR('42');

      const errorMessage =
        "Default target branch 'release/missing' does not exist in your repository. Please update the extension settings.";
      assert.deepStrictEqual(errors, [errorMessage]);
      assert.deepStrictEqual(messages, [
        {
          command: WebviewCommand.FETCH_PR_ERROR,
          message: errorMessage,
        },
      ]);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
  });
});
