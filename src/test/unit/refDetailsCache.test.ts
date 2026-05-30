import * as assert from 'assert';
import * as vscode from 'vscode';

import { IGitRef } from '../../common/git/types';
import { RefDetailsCache, REF_DETAILS_CACHE_TTL_MS } from '../../services/refDetailsCache';

function makeMemoryMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const values = new Map<string, unknown>();
  return {
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
});
