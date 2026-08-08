import * as assert from 'assert';

import {
  computeStackPosition,
  formatStackPosition,
  shouldShowStackIndicator,
} from '../../statusBar/statusBarManager';

describe('computeStackPosition', () => {
  it('returns 1-based bottom-up position and stack size', () => {
    const ordered = ['feat/api', 'feat/ui', 'feat/docs'];

    assert.deepStrictEqual(computeStackPosition('feat/api', ordered), { position: 1, size: 3 });
    assert.deepStrictEqual(computeStackPosition('feat/ui', ordered), { position: 2, size: 3 });
    assert.deepStrictEqual(computeStackPosition('feat/docs', ordered), { position: 3, size: 3 });
  });

  it('returns undefined when the branch is not in the stack', () => {
    assert.strictEqual(computeStackPosition('feat/other', ['feat/api', 'feat/ui']), undefined);
  });
});

describe('formatStackPosition', () => {
  it('formats "2/3" for the middle of a 3-chain', () => {
    assert.strictEqual(formatStackPosition(2, 3), '2/3');
  });

  it('formats the bottom of the stack as position 1', () => {
    assert.strictEqual(formatStackPosition(1, 3), '1/3');
  });
});

describe('shouldShowStackIndicator', () => {
  const base = { stacksEnabled: true, showStatusBar: true, isDetached: false, isInStack: true };

  it('shows when stacks are enabled, status bar is on, HEAD is attached, and branch is in a stack', () => {
    assert.strictEqual(shouldShowStackIndicator(base), true);
  });

  it('hides when stacks.enabled is false', () => {
    assert.strictEqual(shouldShowStackIndicator({ ...base, stacksEnabled: false }), false);
  });

  it('hides when the extension status bar is disabled', () => {
    assert.strictEqual(shouldShowStackIndicator({ ...base, showStatusBar: false }), false);
  });

  it('hides when HEAD is detached', () => {
    assert.strictEqual(shouldShowStackIndicator({ ...base, isDetached: true }), false);
  });

  it('hides when the current branch is not part of any stack', () => {
    assert.strictEqual(shouldShowStackIndicator({ ...base, isInStack: false }), false);
  });
});
