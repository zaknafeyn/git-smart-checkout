import * as assert from 'assert';

import {
  ACTION_ADD_TO_WORKSPACE,
  ACTION_OPEN_FOLDER,
  ACTION_OPEN_IN_NEW_WINDOW,
  getWorktreeCompletionActions,
} from '../../commands/utils/worktreeCompletionActions';

describe('getWorktreeCompletionActions', () => {
  it('offers to add the worktree to the workspace when it is not already a workspace folder', () => {
    // The test host has no workspace folders open, so any path is "not in workspace".
    const actions = getWorktreeCompletionActions('/some/worktree/path');

    assert.deepStrictEqual(actions, [
      ACTION_ADD_TO_WORKSPACE,
      ACTION_OPEN_FOLDER,
      ACTION_OPEN_IN_NEW_WINDOW,
    ]);
  });
});
