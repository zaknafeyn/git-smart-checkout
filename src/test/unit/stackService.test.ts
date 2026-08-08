import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PrStackCache } from '../../services/prStackCache';
import { StackService } from '../../services/stackService';
import { StackStore } from '../../services/stackStore';
import { GitHubPR, GitHubStack } from '../../types/dataTypes';
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

/** A GitHub-native stack fixture: `entries` bottom -> top, matching the Stacks API's own ordering. */
function githubStack(target: string, entries: Array<{ number: number; head: string }>): GitHubStack {
  return {
    id: 1,
    number: 1,
    node_id: 'node-1',
    url: 'https://api.github.com/repos/org/repo/stacks/1',
    base: { ref: target },
    open: true,
    created_at: '2026-01-01T00:00:00Z',
    pull_requests: entries.map((e) => ({
      number: e.number,
      state: 'open',
      draft: false,
      merged_at: null,
      head: { ref: e.head, sha: 'sha' },
    })),
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

/**
 * Stubs both GitHub calls `StackService` makes: the open-PR list (title/url
 * enrichment) and the native Stacks API (structure/order/target). Tests that
 * don't care about stack matching can omit `stacksImpl` — it defaults to "no
 * stacks", which is enough whenever the assertion only cares that the
 * heuristic wasn't consulted.
 */
function stubGithubClient(
  prsImpl: () => Promise<GitHubPR[]>,
  stacksImpl: () => Promise<GitHubStack[]> = async () => []
): () => void {
  const originalPrs = GitHubClient.prototype.listOpenPullRequestsOrThrow;
  const originalStacks = GitHubClient.prototype.listPullRequestStacksOrThrow;
  GitHubClient.prototype.listOpenPullRequestsOrThrow = prsImpl;
  GitHubClient.prototype.listPullRequestStacksOrThrow = stacksImpl;
  return () => {
    GitHubClient.prototype.listOpenPullRequestsOrThrow = originalPrs;
    GitHubClient.prototype.listPullRequestStacksOrThrow = originalStacks;
  };
}

describe('StackService.refreshForRepo', () => {
  it('calls listOpenPullRequestsOrThrow and listPullRequestStacksOrThrow exactly once per refresh', async () => {
    let prCalls = 0;
    let stackCalls = 0;
    const restore = stubGithubClient(
      async () => {
        prCalls++;
        return [pr(12, 'feat/mid', 'target'), pr(52, 'feat/top', 'feat/mid')];
      },
      async () => {
        stackCalls++;
        return [githubStack('target', [{ number: 12, head: 'feat/mid' }, { number: 52, head: 'feat/top' }])];
      }
    );
    try {
      const service = new StackService(
        makeConfigManager('auto'),
        mockLogService,
        new PrStackCache(makeMemento(), mockLogService),
        new StackStore(makeMemento(), mockLogService)
      );
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/mid' }));

      assert.strictEqual(prCalls, 1);
      assert.strictEqual(stackCalls, 1);
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
    await cache.set('/repo', [pr(1, 'feat/a', 'target')]);

    const restore = stubGithubClient(
      async () => {
        throw new Error('rate limited');
      },
      async () => [githubStack('target', [{ number: 1, head: 'feat/a' }])]
    );
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
    const restore = stubGithubClient(
      async () => [pr(12, 'feat/mid', 'target')],
      async () => [githubStack('target', [{ number: 12, head: 'feat/mid' }])]
    );
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
    const restore = stubGithubClient(
      async () => [pr(12, 'feat/mid', 'target')],
      async () => [githubStack('target', [{ number: 12, head: 'feat/mid' }])]
    );
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
