import * as assert from 'assert';
import { type Webview } from 'vscode';

import { WebviewCommand } from '../../types/webviewCommands';
import { postFetchPRError } from '../../view/PrCloneWebViewProvider';

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
});
