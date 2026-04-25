import * as assert from 'assert';

import { createTagTestRepo, TagTestRepo } from './helpers/gitTestRepo';

describe('GitExecutor tag operations', () => {
  let repo: TagTestRepo;

  before(() => {
    repo = createTagTestRepo();
  });

  after(() => {
    repo.cleanup();
  });

  it('createTag creates a tag that tagExists returns true for', async () => {
    await repo.git.createTag('v1.0.0');
    assert.strictEqual(await repo.git.tagExists('v1.0.0'), true);
  });

  it('tagExists returns false for a non-existing tag', async () => {
    assert.strictEqual(await repo.git.tagExists('does-not-exist'), false);
  });

  it('pushTag pushes tag to the remote', async () => {
    await repo.git.createTag('v1.1.0');
    await repo.git.pushTag('v1.1.0', 'origin');
    assert.strictEqual(repo.remoteHasTag('v1.1.0'), true);
  });

  it('listTags returns created tags', async () => {
    const tags = await repo.git.listTags();
    assert.ok(tags.includes('v1.0.0'), 'should include v1.0.0');
    assert.ok(tags.includes('v1.1.0'), 'should include v1.1.0');
  });

  it('recurring pattern: finds first non-existing tag starting from N', async () => {
    await repo.git.createTag('mobile-v1-1');
    await repo.git.createTag('mobile-v1-2');

    let n = 1;
    let candidate = '';
    while (true) {
      candidate = `mobile-v1-${n}`;
      if (!(await repo.git.tagExists(candidate))) {
        break;
      }
      n++;
    }
    assert.strictEqual(candidate, 'mobile-v1-3');
  });

  it('pushTag throws on broken remote but local tag is preserved', async () => {
    await repo.git.createTag('local-only');
    await assert.rejects(() => repo.git.pushTag('local-only', 'nonexistent-remote'));
    assert.strictEqual(await repo.git.tagExists('local-only'), true);
  });

  it('createTag throws when tag already exists', async () => {
    await assert.rejects(() => repo.git.createTag('v1.0.0'));
  });
});
