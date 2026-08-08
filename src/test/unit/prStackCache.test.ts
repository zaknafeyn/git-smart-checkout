import * as assert from 'assert';

import { isPrCacheFresh, PrStackCache } from '../../services/prStackCache';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeMemento() {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T,
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

function makePr(number: number): GitHubPR {
  return {
    number,
    title: `PR ${number}`,
    body: '',
    head: { ref: `feat/${number}`, sha: 'sha' },
    base: { ref: 'main' },
    html_url: `https://github.com/org/repo/pull/${number}`,
    labels: [],
    assignees: [],
  };
}

describe('isPrCacheFresh', () => {
  it('is fresh when age is under the TTL', () => {
    assert.strictEqual(isPrCacheFresh(1000, 1000 + 4999, 5000), true);
  });

  it('is not fresh exactly at the TTL boundary', () => {
    assert.strictEqual(isPrCacheFresh(1000, 1000 + 5000, 5000), false);
  });

  it('is not fresh past the TTL', () => {
    assert.strictEqual(isPrCacheFresh(1000, 1000 + 5001, 5000), false);
  });
});

describe('PrStackCache', () => {
  it('round-trips a cached PR list for a repo key', async () => {
    const cache = new PrStackCache(makeMemento(), mockLogService, 5000);
    await cache.set('/repo/a', [makePr(1), makePr(2)]);

    const entry = cache.get('/repo/a');
    assert.strictEqual(entry?.prs.length, 2);
    assert.strictEqual(cache.get('/repo/b'), undefined);
  });

  it('isFresh reflects the configured TTL', async () => {
    const cache = new PrStackCache(makeMemento(), mockLogService, 1000);
    await cache.set('/repo/a', [makePr(1)]);

    assert.strictEqual(cache.isFresh('/repo/a', Date.now()), true);
    assert.strictEqual(cache.isFresh('/repo/a', Date.now() + 5000), false);
    assert.strictEqual(cache.isFresh('/repo/missing', Date.now()), false);
  });

  it('clear(repoKey) removes only that repo entry', async () => {
    const cache = new PrStackCache(makeMemento(), mockLogService);
    await cache.set('/repo/a', [makePr(1)]);
    await cache.set('/repo/b', [makePr(2)]);

    await cache.clear('/repo/a');

    assert.strictEqual(cache.get('/repo/a'), undefined);
    assert.strictEqual(cache.get('/repo/b')?.prs.length, 1);
  });

  it('clear() with no argument wipes every repo entry', async () => {
    const cache = new PrStackCache(makeMemento(), mockLogService);
    await cache.set('/repo/a', [makePr(1)]);
    await cache.set('/repo/b', [makePr(2)]);

    await cache.clear();

    assert.strictEqual(cache.get('/repo/a'), undefined);
    assert.strictEqual(cache.get('/repo/b'), undefined);
  });

  it('returns undefined without throwing on corrupt stored state', () => {
    const memento = {
      get: () => ({ version: 2, garbage: true }) as unknown,
      update: async () => {},
    };
    const cache = new PrStackCache(memento, mockLogService);
    assert.strictEqual(cache.get('/repo/a'), undefined);
  });

  it('swallows a rejected update() and logs a warning', async () => {
    let warned = false;
    const logService = {
      ...mockLogService,
      warn: () => {
        warned = true;
      },
    } as unknown as typeof mockLogService;
    const memento = {
      get: () => undefined,
      update: async () => {
        throw new Error('quota exceeded');
      },
    };
    const cache = new PrStackCache(memento, logService);

    await cache.set('/repo/a', [makePr(1)]);

    assert.strictEqual(warned, true);
  });

  it('behaves as an empty cache when constructed without storage', async () => {
    const cache = new PrStackCache(undefined, mockLogService);
    await cache.set('/repo/a', [makePr(1)]);
    assert.strictEqual(cache.get('/repo/a'), undefined);
  });
});
