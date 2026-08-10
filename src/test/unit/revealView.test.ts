import * as assert from 'assert';

import { pickRevealCommand } from '../../utils/revealView';

describe('pickRevealCommand', () => {
  const viewId = 'git-smart-checkout.stacks';
  const containerId = 'git-smart-checkout';

  it('uses the workbench focus command when it is registered', () => {
    assert.strictEqual(
      pickRevealCommand(viewId, containerId, ['some.other.command', 'git-smart-checkout.stacks.focus']),
      'git-smart-checkout.stacks.focus'
    );
  });

  it('falls back to opening the view container when the focus command is missing', () => {
    assert.strictEqual(
      pickRevealCommand(viewId, containerId, ['some.other.command']),
      'workbench.view.extension.git-smart-checkout'
    );
  });

  it('falls back when no commands are available at all', () => {
    assert.strictEqual(
      pickRevealCommand(viewId, containerId, []),
      'workbench.view.extension.git-smart-checkout'
    );
  });

  it('does not confuse another view\'s focus command for this one', () => {
    assert.strictEqual(
      pickRevealCommand(viewId, containerId, ['git-smart-checkout.worktrees.focus']),
      'workbench.view.extension.git-smart-checkout'
    );
  });
});
