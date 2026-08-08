import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { StackService } from '../../services/stackService';
import { GitHubPR, GitHubStack } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

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

function makeConfigManager(enabled = true): ConfigurationManager {
  return {
    get: () => ({
      stacks: { enabled },
      githubEnterpriseBaseUrl: '',
    }),
  } as unknown as ConfigurationManager;
}

interface GitStubOptions {
  currentBranch?: string | (() => Promise<string>);
  repoInfo?: { owner: string; repo: string; host: string } | null;
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
    getRepoInfo: async () => (options.repoInfo === undefined ? { owner: 'org', repo: 'repo', host: 'github.com' } : options.repoInfo),
    getAllRefListExtended: async () => options.refs ?? [],
  } as unknown as GitExecutor;
}

/** Stubs both GitHub calls `StackService` makes: the open-PR list and the native Stacks API. */
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
  it('fetches the open-PR list and the stack list exactly once and builds a view for a matching stack', async () => {
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
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/mid' }));

      assert.strictEqual(prCalls, 1);
      assert.strictEqual(stackCalls, 1);
      assert.strictEqual(result.view?.branches.length, 2);
    } finally {
      restore();
    }
  });

  it('reports no view when the current branch is not part of any GitHub stack', async () => {
    const restore = stubGithubClient(
      async () => [pr(1, 'feat/a', 'main')],
      async () => [githubStack('main', [{ number: 1, head: 'feat/a' }])]
    );
    try {
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/unrelated' }));

      assert.strictEqual(result.view, undefined);
    } finally {
      restore();
    }
  });

  it('reports no view when the repo has no GitHub remote', async () => {
    let stackCalls = 0;
    const restore = stubGithubClient(
      async () => [],
      async () => {
        stackCalls++;
        return [];
      }
    );
    try {
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(makeGitStub({ repoInfo: null }));

      assert.strictEqual(stackCalls, 0);
      assert.strictEqual(result.view, undefined);
    } finally {
      restore();
    }
  });

  it('still finds the stack when the open-PR list call fails (title/url fall back to a placeholder)', async () => {
    const restore = stubGithubClient(
      async () => {
        throw new Error('rate limited');
      },
      async () => [githubStack('target', [{ number: 12, head: 'feat/mid' }])]
    );
    try {
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/mid' }));

      assert.strictEqual(result.view?.branches[0]?.pr.title, 'PR #12');
    } finally {
      restore();
    }
  });

  it('reports no view when the stacks API call fails', async () => {
    const restore = stubGithubClient(
      async () => [pr(12, 'feat/mid', 'target')],
      async () => {
        throw new Error('rate limited');
      }
    );
    try {
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(makeGitStub({ currentBranch: 'feat/mid' }));

      assert.strictEqual(result.view, undefined);
    } finally {
      restore();
    }
  });

  it('attaches the target branch ahead/behind for a matched stack', async () => {
    const restore = stubGithubClient(
      async () => [pr(12, 'feat/mid', 'target')],
      async () => [githubStack('target', [{ number: 12, head: 'feat/mid' }])]
    );
    try {
      const service = new StackService(makeConfigManager(), mockLogService);
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
      const service = new StackService(makeConfigManager(), mockLogService);
      const result = await service.refreshForRepo(
        makeGitStub({ currentBranch: 'feat/mid', refs: [{ name: 'target' }] })
      );

      assert.strictEqual(result.view?.targetAheadBehind, undefined);
    } finally {
      restore();
    }
  });

  it('reports isDetached when the current branch cannot be resolved', async () => {
    const service = new StackService(makeConfigManager(), mockLogService);
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
    const service = new StackService(makeConfigManager(false), mockLogService);
    const result = await service.refresh();
    assert.strictEqual(result.view, undefined);
    assert.strictEqual(result.isDetached, false);
  });
});
