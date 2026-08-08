import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PrStackCache } from '../../services/prStackCache';
import { StackService } from '../../services/stackService';
import { StackStore } from '../../services/stackStore';
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

/**
 * `computeLocalAncestryParents` picks the closest ancestor by commit count,
 * and ties are decided by iteration order (trunk first) — so a stub that
 * returns the same distance for every pair makes every non-trunk candidate
 * lose to trunk, flattening any chain. Order the branches root-to-tip so
 * distance grows with chain depth, matching real repo history.
 */
function chainDistance(order: string[]): (a: string, b: string) => Promise<number> {
  return async (a, b) => order.indexOf(b) - order.indexOf(a);
}

function pr(number: number, head: string, base: string): GitHubPR {
  return {
    number,
    title: `PR ${number}`,
    body: '',
    head: { ref: head, sha: 'sha', repo: { full_name: 'org/repo', clone_url: '' } },
    base: { ref: base, repo: { full_name: 'org/repo' } },
    html_url: `https://github.com/org/repo/pull/${number}`,
    state: 'open',
    labels: [],
    assignees: [],
  };
}

function makeConfigManager(detection: string, enabled = true): ConfigurationManager {
  return {
    get: () => ({
      stacks: { enabled, detection },
      githubEnterpriseBaseUrl: '',
    }),
  } as unknown as ConfigurationManager;
}

interface GitStubOptions {
  currentBranch?: string | (() => Promise<string>);
  trunk?: string;
  repoInfo?: { owner: string; repo: string; host: string } | null;
  isAncestor?: (a: string, b: string) => Promise<boolean>;
  revListCount?: (a: string, b: string) => Promise<number>;
  refs?: Array<{ name: string; remote?: string; isTag?: boolean; parsedUpstreamTrack?: [number, number] }>;
}

function makeGitStub(options: GitStubOptions = {}): GitExecutor {
  return {
    repositoryPath: '/repo',
    getCurrentBranch: async () => {
      if (typeof options.currentBranch === 'function') {
        return options.currentBranch();
      }
      return options.currentBranch ?? 'feat/mid';
    },
    getDefaultBranch: async () => options.trunk ?? 'main',
    getRepoInfo: async () => (options.repoInfo === undefined ? { owner: 'org', repo: 'repo', host: 'github.com' } : options.repoInfo),
    getAllRefListExtended: async () => options.refs ?? [],
    isAncestor: options.isAncestor ?? (async () => false),
    revListCount: options.revListCount ?? (async () => 0),
  } as unknown as GitExecutor;
}

function stubGithubClient(impl: () => Promise<GitHubPR[]>): () => void {
  const original = GitHubClient.prototype.listOpenPullRequestsOrThrow;
  GitHubClient.prototype.listOpenPullRequestsOrThrow = impl;
  return () => {
    GitHubClient.prototype.listOpenPullRequestsOrThrow = original;
  };
}

describe('StackService.refreshForRepo', () => {
  it('calls listOpenPullRequestsOrThrow exactly once per refresh for a multi-branch chain', async () => {
    let callCount = 0;
    const restore = stubGithubClient(async () => {
      callCount++;
      return [pr(12, 'feat/mid', 'target'), pr(52, 'feat/top', 'feat/mid')];
    });
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/mid' }));

      assert.strictEqual(callCount, 1);
      assert.strictEqual(result.view?.branches.length, 2);
    } finally {
      restore();
    }
  });

  it('never consults the heuristic when GitHub PR data is available', async () => {
    let isAncestorCalls = 0;
    const restore = stubGithubClient(async () => [pr(1, 'feat/a', 'main')]);
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/a',
          isAncestor: async () => {
            isAncestorCalls++;
            return false;
          },
        })
      );

      assert.strictEqual(isAncestorCalls, 0);
    } finally {
      restore();
    }
  });

  it('falls back to the heuristic source when the repo has no GitHub remote', async () => {
    let ghCalls = 0;
    const restore = stubGithubClient(async () => {
      ghCalls++;
      return [];
    });
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/ui',
          repoInfo: null,
          refs: [{ name: 'feat/api' }, { name: 'feat/ui' }, { name: 'main' }],
          isAncestor: async (a: string, b: string) => {
            const chain: Record<string, string[]> = { 'feat/ui': ['main', 'feat/api'], 'feat/api': ['main'] };
            return (chain[b] ?? []).includes(a);
          },
          revListCount: chainDistance(['main', 'feat/api', 'feat/ui']),
        })
      );

      assert.strictEqual(ghCalls, 0);
      assert.strictEqual(result.view?.source, 'heuristic');
    } finally {
      restore();
    }
  });

  it('uses a fresh cached PR list when the API call throws', async () => {
    const cache = new PrStackCache(makeMemento(), mockLogService, 5 * 60_000);
    // Base is a non-trunk branch: a single PR onto trunk isn't a stack, which
    // would make `view` undefined regardless of source and defeat the assertion.
    await cache.set('/repo', [pr(1, 'feat/a', 'target')]);

    const restore = stubGithubClient(async () => {
      throw new Error('rate limited');
    });
    try {
      const service = new StackService(makeConfigManager('auto'), mockLogService, cache, new StackStore(makeMemento(), mockLogService));
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/a' }));

      assert.strictEqual(result.view?.source, 'github');
    } finally {
      restore();
    }
  });

  it('falls back to the heuristic when the API call throws and the cache is stale', async () => {
    const staleCache = new PrStackCache(makeMemento(), mockLogService, -1);
    await staleCache.set('/repo', [pr(1, 'feat/a', 'main')]);

    const restore = stubGithubClient(async () => {
      throw new Error('rate limited');
    });
    try {
      const service = new StackService(makeConfigManager('auto'), mockLogService, staleCache, new StackStore(makeMemento(), mockLogService));
      const result = await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/ui',
          refs: [{ name: 'feat/api' }, { name: 'feat/ui' }, { name: 'main' }],
          isAncestor: async (a: string, b: string) => {
            const chain: Record<string, string[]> = { 'feat/ui': ['main', 'feat/api'], 'feat/api': ['main'] };
            return (chain[b] ?? []).includes(a);
          },
          revListCount: chainDistance(['main', 'feat/api', 'feat/ui']),
        })
      );

      assert.strictEqual(result.view?.source, 'heuristic');
    } finally {
      restore();
    }
  });

  it('mode "github" never runs the heuristic, even without GitHub data', async () => {
    let isAncestorCalls = 0;
    const restore = stubGithubClient(async () => []);
    try {
      const service = new StackService(
        makeConfigManager('github'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/a',
          repoInfo: null,
          isAncestor: async () => {
            isAncestorCalls++;
            return false;
          },
        })
      );

      assert.strictEqual(isAncestorCalls, 0);
    } finally {
      restore();
    }
  });

  it('mode "local" never calls the GitHub API', async () => {
    let ghCalls = 0;
    const restore = stubGithubClient(async () => {
      ghCalls++;
      return [];
    });
    try {
      const service = new StackService(
        makeConfigManager('local'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/a' }));

      assert.strictEqual(ghCalls, 0);
    } finally {
      restore();
    }
  });

  it('mode "manual" runs no automatic detection at all', async () => {
    let ghCalls = 0;
    let isAncestorCalls = 0;
    const restore = stubGithubClient(async () => {
      ghCalls++;
      return [];
    });
    try {
      const service = new StackService(
        makeConfigManager('manual'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/a',
          isAncestor: async () => {
            isAncestorCalls++;
            return false;
          },
        })
      );

      assert.strictEqual(ghCalls, 0);
      assert.strictEqual(isAncestorCalls, 0);
      assert.strictEqual(result.view, undefined);
    } finally {
      restore();
    }
  });

  it('attaches the target branch ahead/behind for a GitHub-sourced stack', async () => {
    const restore = stubGithubClient(async () => [pr(12, 'feat/mid', 'target')]);
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/mid',
          refs: [{ name: 'target', parsedUpstreamTrack: [1, 3] }],
        })
      );

      assert.deepStrictEqual(result.view?.targetAheadBehind, { ahead: 1, behind: 3 });
    } finally {
      restore();
    }
  });

  it('leaves the target ahead/behind undefined when the target has no upstream', async () => {
    const restore = stubGithubClient(async () => [pr(12, 'feat/mid', 'target')]);
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(
        makeGitStub({ currentBranch: 'feat/mid', refs: [{ name: 'target' }] })
      );

      assert.strictEqual(result.view?.targetAheadBehind, undefined);
    } finally {
      restore();
    }
  });

  it('attaches the target (trunk) ahead/behind for a heuristic-sourced stack', async () => {
    const restore = stubGithubClient(async () => []);
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(
        makeGitStub({
          currentBranch: 'feat/ui',
          repoInfo: null,
          refs: [
            { name: 'feat/api' },
            { name: 'feat/ui' },
            { name: 'main', parsedUpstreamTrack: [0, 5] },
          ],
          isAncestor: async (a: string, b: string) => {
            const chain: Record<string, string[]> = { 'feat/ui': ['main', 'feat/api'], 'feat/api': ['main'] };
            return (chain[b] ?? []).includes(a);
          },
          revListCount: chainDistance(['main', 'feat/api', 'feat/ui']),
        })
      );

      assert.strictEqual(result.view?.source, 'heuristic');
      assert.deepStrictEqual(result.view?.targetAheadBehind, { ahead: 0, behind: 5 });
    } finally {
      restore();
    }
  });

  it('reports isDetached when the current branch cannot be resolved', async () => {
    const service = new StackService(
      makeConfigManager('auto'),
      mockLogService,
      new PrStackCache(makeMemento(), mockLogService),
      new StackStore(makeMemento(), mockLogService)
    );
    const result = await service.refreshForRepo(
      makeGitStub({
        currentBranch: () => Promise.reject(new Error('detached HEAD')),
      })
    );

    assert.strictEqual(result.isDetached, true);
    assert.strictEqual(result.view, undefined);
  });
});

describe('StackService.refresh', () => {
  it('returns an empty result when stacks are disabled', async () => {
    const service = new StackService(
      makeConfigManager('auto', false),
      mockLogService,
      new PrStackCache(makeMemento(), mockLogService),
      new StackStore(makeMemento(), mockLogService)
    );
    const result = await service.refresh();
    assert.strictEqual(result.view, undefined);
    assert.strictEqual(result.isDetached, false);
  });
});
