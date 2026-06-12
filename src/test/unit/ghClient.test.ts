import * as assert from 'assert';

import { GitHubClient } from '../../common/api/ghClient';
import { GitHubCommit, GitHubLabel } from '../../types/dataTypes';

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
