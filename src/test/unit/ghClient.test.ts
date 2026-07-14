import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { GitHubCommit, GitHubLabel, GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

interface RequestCall {
  endpoint: string;
  method?: string;
  body?: unknown;
}

function createPullRequest(number = 42): GitHubPR {
  return {
    number,
    title: 'Original PR',
    body: 'Body',
    head: {
      ref: 'feature/original',
      sha: 'abc123',
    },
    base: {
      ref: 'main',
    },
    html_url: `https://github.com/owner/repo/pull/${number}`,
    labels: [
      {
        id: 1,
        name: 'bug',
        description: null,
        color: 'ff0000',
        default: false,
      },
    ],
    assignees: [
      {
        id: 2,
        login: 'octocat',
        avatar_url: 'https://github.com/octocat.png',
      },
    ],
    requested_reviewers: [
      {
        id: 3,
        login: 'reviewer-one',
        avatar_url: 'https://github.com/reviewer-one.png',
      },
    ],
    requested_teams: [{ slug: 'core-team' }],
  };
}

describe('GitHubClient.createPullRequest', () => {
  it('creates the PR before copying labels and assignees through the Issues API', async () => {
    const client = new GitHubClient('owner', 'repo');
    const newPr = createPullRequest();
    const requests: RequestCall[] = [];

    (client as any).makeRequest = async (
      endpoint: string,
      method?: string,
      body?: unknown
    ) => {
      requests.push({ endpoint, method, body });
      return newPr;
    };

    const result = await client.createPullRequest(
      'Cloned PR',
      'Description',
      'feature/cloned',
      'main',
      true,
      ['bug', 'priority'],
      ['octocat']
    );

    assert.strictEqual(result, newPr);
    assert.deepStrictEqual(requests, [
      {
        endpoint: '/repos/owner/repo/pulls',
        method: 'POST',
        body: {
          title: 'Cloned PR',
          body: 'Description',
          head: 'feature/cloned',
          base: 'main',
          draft: true,
        },
      },
      {
        endpoint: '/repos/owner/repo/issues/42/labels',
        method: 'POST',
        body: { labels: ['bug', 'priority'] },
      },
      {
        endpoint: '/repos/owner/repo/issues/42/assignees',
        method: 'POST',
        body: { assignees: ['octocat'] },
      },
    ]);
  });

  it('warns on metadata failures and still returns the created PR', async () => {
    const newPr = createPullRequest();
    const requests: RequestCall[] = [];
    const warnings: Array<{ message: string; error: unknown }> = [];
    const client = new GitHubClient('owner', 'repo', (message, error) => {
      warnings.push({ message, error });
    });

    (client as any).makeRequest = async (
      endpoint: string,
      method?: string,
      body?: unknown
    ) => {
      requests.push({ endpoint, method, body });
      if (endpoint.endsWith('/labels')) {
        throw new Error('labels forbidden');
      }
      if (endpoint.endsWith('/assignees')) {
        throw new Error('assignees forbidden');
      }
      return newPr;
    };

    const result = await client.createPullRequest(
      'Cloned PR',
      'Description',
      'feature/cloned',
      'main',
      false,
      ['bug'],
      ['octocat']
    );

    assert.strictEqual(result, newPr);
    assert.deepStrictEqual(
      requests.map(({ endpoint }) => endpoint),
      [
        '/repos/owner/repo/pulls',
        '/repos/owner/repo/issues/42/labels',
        '/repos/owner/repo/issues/42/assignees',
      ]
    );
    assert.strictEqual(warnings.length, 2);
    assert.match(warnings[0].message, /Failed to copy labels to PR #42/);
    assert.match(warnings[1].message, /Failed to copy assignees to PR #42/);
  });

  it('copies reviewers and team reviewers through the requested_reviewers API', async () => {
    const client = new GitHubClient('owner', 'repo');
    const newPr = createPullRequest();
    const requests: RequestCall[] = [];

    (client as any).makeRequest = async (
      endpoint: string,
      method?: string,
      body?: unknown
    ) => {
      requests.push({ endpoint, method, body });
      return newPr;
    };

    const result = await client.createPullRequest(
      'Cloned PR',
      'Description',
      'feature/cloned',
      'main',
      true,
      [],
      [],
      ['reviewer-one'],
      ['core-team']
    );

    assert.strictEqual(result, newPr);
    const reviewerRequest = requests.find((request) =>
      request.endpoint.endsWith('/requested_reviewers')
    );
    assert.deepStrictEqual(reviewerRequest, {
      endpoint: '/repos/owner/repo/pulls/42/requested_reviewers',
      method: 'POST',
      body: { reviewers: ['reviewer-one'], team_reviewers: ['core-team'] },
    });
  });

  it('does not call the requested_reviewers API when no reviewers are provided', async () => {
    const client = new GitHubClient('owner', 'repo');
    const newPr = createPullRequest();
    const requests: RequestCall[] = [];

    (client as any).makeRequest = async (
      endpoint: string,
      method?: string,
      body?: unknown
    ) => {
      requests.push({ endpoint, method, body });
      return newPr;
    };

    await client.createPullRequest(
      'Cloned PR',
      'Description',
      'feature/cloned',
      'main',
      true,
      [],
      []
    );

    assert.ok(
      !requests.some((request) => request.endpoint.endsWith('/requested_reviewers')),
      'should not call the requested_reviewers endpoint'
    );
  });

  it('warns on a reviewer-copy failure and still returns the created PR', async () => {
    const newPr = createPullRequest();
    const warnings: Array<{ message: string; error: unknown }> = [];
    const client = new GitHubClient('owner', 'repo', (message, error) => {
      warnings.push({ message, error });
    });

    (client as any).makeRequest = async (endpoint: string) => {
      if (endpoint.endsWith('/requested_reviewers')) {
        throw new Error('reviewers forbidden');
      }
      return newPr;
    };

    const result = await client.createPullRequest(
      'Cloned PR',
      'Description',
      'feature/cloned',
      'main',
      false,
      [],
      [],
      ['reviewer-one']
    );

    assert.strictEqual(result, newPr);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0].message, /Failed to copy reviewers to PR #42/);
  });
});

describe('GitHubClient.getCurrentUserLogin', () => {
  it('fetches and caches the authenticated user login', async () => {
    const client = new GitHubClient('owner', 'repo');
    let callCount = 0;
    (client as any).makeRequest = async () => {
      callCount++;
      return { login: 'octocat' };
    };

    const first = await client.getCurrentUserLogin();
    const second = await client.getCurrentUserLogin();

    assert.strictEqual(first, 'octocat');
    assert.strictEqual(second, 'octocat');
    assert.strictEqual(callCount, 1, 'should only fetch the current user once (cached)');
  });

  it('returns undefined and warns when the current-user request fails', async () => {
    const warnings: Array<{ message: string; error: unknown }> = [];
    const client = new GitHubClient('owner', 'repo', (message, error) => {
      warnings.push({ message, error });
    });
    (client as any).makeRequest = async () => {
      throw new Error('unauthorized');
    };

    const result = await client.getCurrentUserLogin();

    assert.strictEqual(result, undefined);
    assert.strictEqual(warnings.length, 1);
  });
});

describe('PrCloneTempWorktreeService metadata parity', () => {
  it('passes original labels, assignees, and reviewers when creating the cloned PR', async () => {
    const calls: unknown[][] = [];
    const newPr = createPullRequest(84);
    const ghClient = {
      createPullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return newPr;
      },
      getCurrentUserLogin: async () => 'someone-else',
    } as unknown as GitHubClient;
    const service = new PrCloneTempWorktreeService(
      {} as GitExecutor,
      ghClient,
      mockLogService
    );

    const result = await (service as any).createGitHubPR(
      createPullRequest(),
      'feature/cloned',
      'release',
      'Description',
      true
    );

    assert.strictEqual(result, newPr);
    assert.deepStrictEqual(calls, [
      [
        'Original PR',
        'Description',
        'feature/cloned',
        'release',
        true,
        ['bug'],
        ['octocat'],
        ['reviewer-one'],
        ['core-team'],
      ],
    ]);
  });

  it('excludes the authenticated user from the requested reviewers (self-review is rejected by GitHub)', async () => {
    const calls: unknown[][] = [];
    const newPr = createPullRequest(84);
    const ghClient = {
      createPullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return newPr;
      },
      getCurrentUserLogin: async () => 'reviewer-one',
    } as unknown as GitHubClient;
    const service = new PrCloneTempWorktreeService(
      {} as GitExecutor,
      ghClient,
      mockLogService
    );

    await (service as any).createGitHubPR(
      createPullRequest(),
      'feature/cloned',
      'release',
      'Description',
      true
    );

    const reviewers = calls[0][7] as string[];
    assert.deepStrictEqual(reviewers, []);
  });
});

describe('PrCloneInPlaceService metadata parity', () => {
  it('passes original labels, assignees, and reviewers when creating the cloned PR', async () => {
    const calls: unknown[][] = [];
    const newPr = createPullRequest(84);
    const ghClient = {
      createPullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return newPr;
      },
      getCurrentUserLogin: async () => 'someone-else',
    } as unknown as GitHubClient;
    const service = new PrCloneInPlaceService({} as GitExecutor, ghClient, mockLogService);

    const result = await (service as any).createGitHubPR(
      createPullRequest(),
      'feature/cloned',
      'release',
      'Description',
      true
    );

    assert.strictEqual(result, newPr);
    assert.deepStrictEqual(calls, [
      [
        'Original PR',
        'Description',
        'feature/cloned',
        'release',
        true,
        ['bug'],
        ['octocat'],
        ['reviewer-one'],
        ['core-team'],
      ],
    ]);
  });

  it('excludes the authenticated user from the requested reviewers (self-review is rejected by GitHub)', async () => {
    const calls: unknown[][] = [];
    const newPr = createPullRequest(84);
    const ghClient = {
      createPullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return newPr;
      },
      getCurrentUserLogin: async () => 'reviewer-one',
    } as unknown as GitHubClient;
    const service = new PrCloneInPlaceService({} as GitExecutor, ghClient, mockLogService);

    await (service as any).createGitHubPR(
      createPullRequest(),
      'feature/cloned',
      'release',
      'Description',
      true
    );

    const reviewers = calls[0][7] as string[];
    assert.deepStrictEqual(reviewers, []);
  });
});

/**
 * The pagination logic lives in the private `makePaginatedRequest`, which is
 * exercised through the public `fetchPullRequestCommits` / `fetchLabels`
 * methods. We stub the private `makeRequest` transport seam to simulate GitHub
 * returning multiple pages.
 */
type MakeRequestStub = (endpoint: string) => Promise<unknown>;

function stubMakeRequest(client: GitHubClient, stub: MakeRequestStub): string[] {
  const calls: string[] = [];
  (client as any).makeRequest = (endpoint: string) => {
    calls.push(endpoint);
    return stub(endpoint);
  };
  return calls;
}

function makeCommits(count: number, startIndex: number): GitHubCommit[] {
  return Array.from({ length: count }, (_v, i) => ({
    sha: `sha-${startIndex + i}`,
    commit: { message: `commit ${startIndex + i}` },
    parents: [],
  }));
}

describe('GitHubClient pagination', () => {
  describe('fetchPullRequestCommits', () => {
    it('follows pages and returns all commits (100 + 100 + 12 = 212)', async () => {
      const client = new GitHubClient('owner', 'repo');
      const pages = [makeCommits(100, 0), makeCommits(100, 100), makeCommits(12, 200)];

      const calls = stubMakeRequest(client, () => Promise.resolve(pages.shift() ?? []));

      const commits = await client.fetchPullRequestCommits(1);

      assert.strictEqual(commits.length, 212, 'should return all 212 commits across pages');
      assert.strictEqual(commits[0].sha, 'sha-0');
      assert.strictEqual(commits[211].sha, 'sha-211');

      // 3 requests: stops because the last page (12) is shorter than per_page (100).
      assert.strictEqual(calls.length, 3);
      assert.ok(calls[0].includes('per_page=100'));
      assert.ok(calls[0].includes('page=1'));
      assert.ok(calls[1].includes('page=2'));
      assert.ok(calls[2].includes('page=3'));
    });

    it('stops after a single request when fewer than a full page is returned', async () => {
      const client = new GitHubClient('owner', 'repo');
      const calls = stubMakeRequest(client, () => Promise.resolve(makeCommits(5, 0)));

      const commits = await client.fetchPullRequestCommits(1);

      assert.strictEqual(commits.length, 5);
      assert.strictEqual(calls.length, 1);
    });

    it('appends the per_page/page params with & when the endpoint already has a query', async () => {
      const client = new GitHubClient('owner', 'repo');
      const calls = stubMakeRequest(client, () => Promise.resolve([]));

      // Force a query-string endpoint by exercising the private helper directly.
      await (client as any).makePaginatedRequest('/foo?state=all');

      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].includes('?state=all&per_page=100&page=1'));
    });
  });

  describe('fetchLabels', () => {
    it('returns labels from every page', async () => {
      const client = new GitHubClient('owner', 'repo');
      const page1: GitHubLabel[] = Array.from({ length: 100 }, (_v, i) => ({
        id: i,
        name: `label-${i}`,
        description: null,
        color: 'ffffff',
        default: false,
      }));
      const page2: GitHubLabel[] = [
        { id: 100, name: 'label-100', description: null, color: '000000', default: false },
      ];
      const pages = [page1, page2];

      stubMakeRequest(client, () => Promise.resolve(pages.shift() ?? []));

      const labels = await client.fetchLabels();
      assert.strictEqual(labels.length, 101);
    });
  });
});
