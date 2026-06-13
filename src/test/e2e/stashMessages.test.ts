import * as assert from 'assert';

import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

describe('GitExecutor stash message matching', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('finds and pops a stash whose message contains ": "', async () => {
    const stashName = 'auto-stash-main: extra context';
    repo.makeChange('file1.txt', 'colon pop content\n');

    await repo.git.createStash(stashName);

    assert.strictEqual(await repo.git.isStashWithMessageExists(stashName), true);

    await repo.git.popStash(stashName);

    assert.strictEqual(repo.readFile('file1.txt'), 'colon pop content\n');
    assert.strictEqual(repo.stashCount(), 0, 'pop should remove the matching stash');
  });

  it('finds and applies a stash whose message contains multiple ": " delimiters', async () => {
    const stashName = 'manual stash: review: checkpoint';
    repo.makeChange('file1.txt', 'colon apply content\n');

    await repo.git.createStash(stashName);
    await repo.git.popStash(stashName, true);

    assert.strictEqual(repo.readFile('file1.txt'), 'colon apply content\n');
    assert.strictEqual(repo.stashCount(), 1, 'apply should preserve the matching stash');
  });
});
