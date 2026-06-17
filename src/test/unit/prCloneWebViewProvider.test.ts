import * as assert from 'assert';
import { type Webview } from 'vscode';

import { GitHubApiError } from '../../common/api/ghClient';
import { WebviewCommand } from '../../types/webviewCommands';
import {
  getFetchPRErrorNotification,
  postFetchPRError,
} from '../../view/PrCloneWebViewProvider';

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
    assert.match(
      notification.detail,
      /GET https:\/\/api\.github\.com\/repos\/owner\/repo\/pulls\/42/
    );
    assert.match(notification.detail, /network timeout/);
  });
});
