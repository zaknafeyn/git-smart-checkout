import * as assert from 'assert';
import * as vscode from 'vscode';

import { IGitRef } from '../../common/git/types';
import { RefDetailsCache, REF_DETAILS_CACHE_TTL_MS } from '../../services/refDetailsCache';

function makeMemoryMemento(): Pick<vscode.Memento, 'get' | 'update'> & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

function makeRef(overrides: Partial<IGitRef> = {}): IGitRef {
  return {
    name: 'main',
    fullName: 'main',
    hash: 'abc123',
    authorName: '',
    ...overrides,
  };
}

describe('RefDetailsCache', () => {
  it('returns cached details for the same repo, ref, hash, and fresh TTL', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const ref = makeRef();

    await cache.upsert('repo', ref, {
      hash: 'abc123d',
      comment: 'Initial subject',
      authorName: 'A',
      committerDate: '1700000000',
      parsedUpstreamTrack: [1, 2],
    }, 1000);

    assert.deepStrictEqual(cache.get('repo', ref, 1000 + REF_DETAILS_CACHE_TTL_MS - 1), {
      hash: 'abc123d',
      comment: 'Initial subject',
      authorName: 'A',
      committerDate: '1700000000',
      parsedUpstreamTrack: [1, 2],
    });
  });

  it('treats entries older than 48 hours as misses', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const ref = makeRef();

    await cache.upsert('repo', ref, { comment: 'Old subject' }, 1000);

    assert.strictEqual(cache.get('repo', ref, 1000 + REF_DETAILS_CACHE_TTL_MS + 1), undefined);
  });

  it('treats entries with a different ref hash as misses', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());

    await cache.upsert('repo', makeRef({ hash: 'abc123' }), { comment: 'Old subject' }, 1000);

    assert.strictEqual(cache.get('repo', makeRef({ hash: 'def456' }), 1000), undefined);
  });

  it('does nothing when storage is unavailable', async () => {
    const cache = new RefDetailsCache(undefined);
    const ref = makeRef();

    await cache.upsert('repo', ref, { comment: 'Subject' }, 1000);

    assert.strictEqual(cache.get('repo', ref, 1000), undefined);
  });

  it('applies cached details to refs in place', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const ref = makeRef();

    await cache.upsert('repo', ref, { comment: 'Cached subject', authorName: 'A' }, 1000);
    cache.apply('repo', [ref], 1000);

    assert.strictEqual(ref.comment, 'Cached subject');
    assert.strictEqual(ref.authorName, 'A');
  });

  it('keeps cache entries isolated by repository and canonical ref name', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const local = makeRef({ name: 'shared', fullName: 'shared', hash: 'abc123' });
    const remote = makeRef({
      name: 'shared',
      fullName: 'origin/shared',
      remote: 'origin',
      hash: 'abc123',
    });

    await cache.upsert('repo-a', local, { comment: 'repo a local' }, 1000);
    await cache.upsert('repo-a', remote, { comment: 'repo a remote' }, 1000);
    await cache.upsert('repo-b', local, { comment: 'repo b local' }, 1000);

    assert.strictEqual(cache.get('repo-a', local, 1000)?.comment, 'repo a local');
    assert.strictEqual(cache.get('repo-a', remote, 1000)?.comment, 'repo a remote');
    assert.strictEqual(cache.get('repo-b', local, 1000)?.comment, 'repo b local');
  });

  it('updates cached details when the same branch hash receives refreshed data', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const ref = makeRef();

    await cache.upsert('repo', ref, { comment: 'Old subject', authorName: 'A' }, 1000);
    await cache.upsert('repo', ref, { comment: 'New subject', authorName: 'B' }, 2000);

    assert.deepStrictEqual(cache.get('repo', ref, 2000), {
      comment: 'New subject',
      authorName: 'B',
    });
  });

  it('stores the refreshed branch hash so the previous hash becomes stale after a branch moves', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const oldRef = makeRef({ hash: 'old-hash' });
    const newRef = makeRef({ hash: 'new-hash' });

    await cache.upsert('repo', oldRef, { comment: 'Old commit' }, 1000);
    await cache.upsert('repo', newRef, { comment: 'New commit' }, 2000);

    assert.strictEqual(cache.get('repo', oldRef, 2000), undefined);
    assert.deepStrictEqual(cache.get('repo', newRef, 2000), { comment: 'New commit' });
  });

  it('does not store unsupported fields from refs or fetched details', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());
    const ref = makeRef({ upstreamTrack: '[ahead 1]' });

    await cache.upsert('repo', ref, {
      comment: 'Subject',
      upstreamTrack: '[ahead 1]',
      remote: 'origin',
      name: 'ignored',
      fullName: 'ignored',
    }, 1000);

    assert.deepStrictEqual(cache.get('repo', ref, 1000), { comment: 'Subject' });
  });

  it('serializes concurrent writes without dropping entries', async () => {
    const cache = new RefDetailsCache(makeMemoryMemento());

    await Promise.all([
      cache.upsert('repo', makeRef({ name: 'one', fullName: 'one', hash: '1' }), { comment: 'one' }, 1000),
      cache.upsert('repo', makeRef({ name: 'two', fullName: 'two', hash: '2' }), { comment: 'two' }, 1000),
      cache.upsert('repo', makeRef({ name: 'three', fullName: 'three', hash: '3' }), { comment: 'three' }, 1000),
    ]);

    assert.strictEqual(
      cache.get('repo', makeRef({ name: 'one', fullName: 'one', hash: '1' }), 1000)?.comment,
      'one'
    );
    assert.strictEqual(
      cache.get('repo', makeRef({ name: 'two', fullName: 'two', hash: '2' }), 1000)?.comment,
      'two'
    );
    assert.strictEqual(
      cache.get('repo', makeRef({ name: 'three', fullName: 'three', hash: '3' }), 1000)?.comment,
      'three'
    );
  });
});
