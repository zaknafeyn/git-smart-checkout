import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { GitHubPR } from '../../types/dataTypes';
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
});

describe('PrCloneTempWorktreeService metadata parity', () => {
  it('passes original labels and assignees when creating the cloned PR', async () => {
    const calls: unknown[][] = [];
    const newPr = createPullRequest(84);
    const ghClient = {
      createPullRequest: async (...args: unknown[]) => {
        calls.push(args);
        return newPr;
      },
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
      ],
    ]);
  });
});
