import * as assert from 'assert';

import { ThemeColor } from 'vscode';
import {
  AUTO_STASH_MODE_APPLY,
  AUTO_STASH_MODE_BRANCH,
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODE_POP,
} from '../../configuration/extensionConfig';
import { getStatusBarBackgroundColor } from '../../statusBar/statusBarManager';

describe('getStatusBarBackgroundColor', () => {
  it('uses the default status bar background in manual mode', () => {
    assert.strictEqual(getStatusBarBackgroundColor(AUTO_STASH_MODE_MANUAL), undefined);
  });

  for (const mode of [
    AUTO_STASH_MODE_BRANCH,
    AUTO_STASH_MODE_POP,
    AUTO_STASH_MODE_APPLY,
  ] as const) {
    it(`uses the warning background in ${mode} mode`, () => {
      const color = getStatusBarBackgroundColor(mode);

      assert.ok(color instanceof ThemeColor);
      assert.deepStrictEqual(color, new ThemeColor('statusBarItem.warningBackground'));
    });
  }
});
