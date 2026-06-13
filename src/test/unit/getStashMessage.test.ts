import * as assert from 'assert';

import { getStashMessage } from '../../commands/utils/getStashMessage';

describe('getStashMessage', () => {
  it('keeps the branch-only stash name unchanged', () => {
    assert.strictEqual(getStashMessage('feature/example'), 'auto-stash-feature/example');
  });

  it('uses a quoted T and 24-hour time for dated stash names', () => {
    const morning = new Date(2026, 5, 12, 1, 23, 45);
    const afternoon = new Date(2026, 5, 12, 13, 23, 45);

    assert.strictEqual(
      getStashMessage('feature/example', true, morning),
      'auto-stash-feature/example-2026-06-12T01:23:45'
    );
    assert.strictEqual(
      getStashMessage('feature/example', true, afternoon),
      'auto-stash-feature/example-2026-06-12T13:23:45'
    );
  });
});
