import * as assert from 'assert';

import { WebviewCommand } from '../../types/webviewCommands';
import {
  FETCH_PR_LOADING_TIMEOUT,
  fetchPRLoadingReducer,
} from '../../webview/Apps/PR/App/fetchPRLoadingState';

describe('fetchPRLoadingReducer', () => {
  it('starts loading when a PR fetch is submitted', () => {
    assert.strictEqual(fetchPRLoadingReducer(false, WebviewCommand.FETCH_PR), true);
  });

  it('stops loading when PR data is received', () => {
    assert.strictEqual(fetchPRLoadingReducer(true, WebviewCommand.SHOW_PR_DATA), false);
  });

  it('stops loading when the PR fetch fails', () => {
    assert.strictEqual(fetchPRLoadingReducer(true, WebviewCommand.FETCH_PR_ERROR), false);
  });

  it('stops loading when the user cancels', () => {
    assert.strictEqual(fetchPRLoadingReducer(true, WebviewCommand.CANCEL_PR_CLONE), false);
  });

  it('stops loading when the PR fetch response times out', () => {
    assert.strictEqual(fetchPRLoadingReducer(true, FETCH_PR_LOADING_TIMEOUT), false);
  });

  it('preserves loading state for unrelated messages', () => {
    assert.strictEqual(fetchPRLoadingReducer(true, WebviewCommand.UPDATE_REPO_INFO), true);
  });
});
