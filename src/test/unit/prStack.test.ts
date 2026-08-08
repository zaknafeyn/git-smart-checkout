import * as assert from 'assert';

import { findGithubStackForBranch, prStackFromGithubStack } from '../../services/prStack';
import { GitHubPR, GitHubStack, GitHubStackPr } from '../../types/dataTypes';

function stackPr(number: number, head: string, opts: Partial<GitHubStackPr> = {}): GitHubStackPr {
  return {
    number,
    state: 'open',
    draft: false,
    merged_at: null,
    head: { ref: head, sha: `sha-${number}` },
    ...opts,
  };
}

function stack(target: string, pull_requests: GitHubStackPr[], overrides: Partial<GitHubStack> = {}): GitHubStack {
  return {
    id: 1,
    number: 1,
    node_id: 'node-1',
    url: 'https://api.github.com/repos/org/repo/stacks/1',
    base: { ref: target },
    open: true,
    created_at: '2026-01-01T00:00:00Z',
    pull_requests,
    ...overrides,
  };
}

function pr(number: number, title: string): GitHubPR {
  return {
    number,
    title,
    body: '',
    head: { ref: `head-${number}`, sha: 'sha' },
    base: { ref: 'target' },
    html_url: `https://github.com/org/repo/pull/${number}`,
    state: 'open',
    labels: [],
    assignees: [],
  };
}

const resolveUrl = (n: number): string => `https://github.com/org/repo/pull/${n}`;

describe('findGithubStackForBranch', () => {
  it('finds the stack a branch belongs to as a stacked PR head', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')])];

    assert.strictEqual(findGithubStackForBranch(stacks, 'feat/top'), stacks[0]);
  });

  it('finds the stack when the branch is the target itself', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    assert.strictEqual(findGithubStackForBranch(stacks, 'target'), stacks[0]);
  });

  it('returns undefined when the branch is part of no stack', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    assert.strictEqual(findGithubStackForBranch(stacks, 'feat/unrelated'), undefined);
  });

  it('picks the correct stack among several', () => {
    const stacks = [
      stack('main', [stackPr(1, 'feat/a')]),
      stack('release', [stackPr(2, 'feat/b')]),
    ];

    assert.strictEqual(findGithubStackForBranch(stacks, 'feat/b'), stacks[1]);
  });
});

describe('prStackFromGithubStack', () => {
  it('builds nodes in the API-given bottom-to-top order, enriched with PR title/url', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')]);
    const prs = [pr(12, 'Mid feature'), pr(52, 'Top feature')];

    const result = prStackFromGithubStack(githubStack, prs, 'feat/mid', resolveUrl);

    assert.strictEqual(result.target, 'target');
    assert.deepStrictEqual(
      result.nodes.map((n) => [n.branch, n.prNumber, n.title, n.url]),
      [
        ['feat/mid', 12, 'Mid feature', 'https://github.com/org/repo/pull/12'],
        ['feat/top', 52, 'Top feature', 'https://github.com/org/repo/pull/52'],
      ]
    );
  });

  it('falls back to a placeholder title/url when a stack member has no matching open PR', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid')]);

    const result = prStackFromGithubStack(githubStack, [], 'feat/mid', resolveUrl);

    assert.strictEqual(result.nodes[0].title, 'PR #12');
    assert.strictEqual(result.nodes[0].url, 'https://github.com/org/repo/pull/12');
  });

  it('carries state/draft straight from the stack member, not the open-PR list', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid', { draft: true })]);

    const result = prStackFromGithubStack(githubStack, [pr(12, 'Mid feature')], 'feat/mid', resolveUrl);

    assert.strictEqual(result.nodes[0].draft, true);
    assert.strictEqual(result.nodes[0].state, 'open');
  });

  it('sets currentIndex to the matching node', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')]);

    const result = prStackFromGithubStack(githubStack, [], 'feat/top', resolveUrl);

    assert.strictEqual(result.currentIndex, 1);
  });

  it('sets currentIndex to -1 when the current branch is the target', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid')]);

    const result = prStackFromGithubStack(githubStack, [], 'target', resolveUrl);

    assert.strictEqual(result.currentIndex, -1);
  });
});
