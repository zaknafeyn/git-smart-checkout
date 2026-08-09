import * as assert from 'assert';

import {
  findGithubStackForBranch,
  findGithubStackForCheckout,
  isBlockedDownstack,
  prStackFromGithubStack,
  stackMemberStatus,
  StackMatch,
} from '../../services/prStack';
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

describe('findGithubStackForCheckout', () => {
  it('matches by PR number (e.g. a `pr/<n>-review` worktree)', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')])];

    const match = findGithubStackForCheckout(stacks, { branch: 'pr/52-review', prNumber: 52 });

    assert.strictEqual(match?.stack, stacks[0]);
    assert.strictEqual(match?.kind, 'prNumber');
    assert.strictEqual(match?.prNumber, 52);
  });

  it('matches by branch (head ref)', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')])];

    const match = findGithubStackForCheckout(stacks, { branch: 'feat/top' });

    assert.strictEqual(match?.kind, 'branch');
    assert.strictEqual(match?.prNumber, 52);
  });

  it('matches by upstream ref when the local branch was renamed', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    const match = findGithubStackForCheckout(stacks, { branch: 'my-rename', upstreamRef: 'feat/mid' });

    assert.strictEqual(match?.kind, 'upstream');
    assert.strictEqual(match?.prNumber, 12);
  });

  it('matches by HEAD sha on a detached checkout', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    const match = findGithubStackForCheckout(stacks, { headSha: 'sha-12' });

    assert.strictEqual(match?.kind, 'sha');
    assert.strictEqual(match?.prNumber, 12);
  });

  it('matches the target only when no member matches', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    const match = findGithubStackForCheckout(stacks, { branch: 'target' });

    assert.strictEqual(match?.kind, 'target');
    assert.strictEqual(match?.prNumber, undefined);
  });

  it('prefers a member match over a target match on a different stack', () => {
    // Standing on 'main': it's the target of stack A, but the member of stack B — the member wins.
    const stackA = stack('main', [stackPr(1, 'feat/a')]);
    const stackB = stack('release', [stackPr(2, 'main')]);

    const match = findGithubStackForCheckout([stackA, stackB], { branch: 'main' });

    assert.strictEqual(match?.stack, stackB);
    assert.strictEqual(match?.kind, 'branch');
  });

  it('ranks prNumber above branch above upstream above sha', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid', { head: { ref: 'feat/mid', sha: 'sha-12' } })])];

    const match = findGithubStackForCheckout(stacks, {
      branch: 'feat/mid',
      upstreamRef: 'feat/mid',
      headSha: 'sha-12',
      prNumber: undefined,
    });

    assert.strictEqual(match?.kind, 'branch');
  });

  it('excludes dissolved stacks (open: false)', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')], { open: false })];

    assert.strictEqual(findGithubStackForCheckout(stacks, { branch: 'feat/mid' }), undefined);
  });

  it('returns undefined when nothing matches', () => {
    const stacks = [stack('target', [stackPr(12, 'feat/mid')])];

    assert.strictEqual(findGithubStackForCheckout(stacks, { branch: 'unrelated' }), undefined);
  });

  it('breaks ties between equally-scored matches by newer created_at, then higher stack number', () => {
    const older = stack('target', [stackPr(1, 'shared')], { number: 1, created_at: '2026-01-01T00:00:00Z' });
    const newer = stack('target', [stackPr(2, 'shared')], { number: 2, created_at: '2026-02-01T00:00:00Z' });

    const match = findGithubStackForCheckout([older, newer], { branch: 'shared' });

    assert.strictEqual(match?.stack, newer);
  });
});

describe('stackMemberStatus', () => {
  it('is merged when merged_at is set', () => {
    assert.strictEqual(stackMemberStatus(stackPr(1, 'b', { merged_at: '2026-01-01T00:00:00Z' })), 'merged');
  });

  it('is closed when state is closed and not merged', () => {
    assert.strictEqual(stackMemberStatus(stackPr(1, 'b', { state: 'closed' })), 'closed');
  });

  it('is draft when open and draft', () => {
    assert.strictEqual(stackMemberStatus(stackPr(1, 'b', { draft: true })), 'draft');
  });

  it('is open otherwise', () => {
    assert.strictEqual(stackMemberStatus(stackPr(1, 'b')), 'open');
  });
});

describe('isBlockedDownstack', () => {
  it('is blocked when a draft member sits below it', () => {
    const members = [stackPr(1, 'a', { draft: true }), stackPr(2, 'b')];
    assert.strictEqual(isBlockedDownstack(members, 1), true);
  });

  it('is blocked when a closed member sits below it', () => {
    const members = [stackPr(1, 'a', { state: 'closed' }), stackPr(2, 'b')];
    assert.strictEqual(isBlockedDownstack(members, 1), true);
  });

  it('is not blocked when the member below is merged', () => {
    const members = [stackPr(1, 'a', { merged_at: '2026-01-01T00:00:00Z' }), stackPr(2, 'b')];
    assert.strictEqual(isBlockedDownstack(members, 1), false);
  });

  it('is not blocked when nothing sits below it', () => {
    const members = [stackPr(1, 'a')];
    assert.strictEqual(isBlockedDownstack(members, 0), false);
  });

  it('is not blocked for an already-merged or closed member', () => {
    const members = [stackPr(1, 'a', { draft: true }), stackPr(2, 'b', { merged_at: '2026-01-01T00:00:00Z' })];
    assert.strictEqual(isBlockedDownstack(members, 1), false);
  });
});

describe('prStackFromGithubStack', () => {
  it('builds nodes in the API-given bottom-to-top order, enriched with PR title/url', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')]);
    const prs = [pr(12, 'Mid feature'), pr(52, 'Top feature')];
    const match: StackMatch = { stack: githubStack, kind: 'branch', prNumber: 12 };

    const result = prStackFromGithubStack(githubStack, prs, match, resolveUrl);

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
    const match: StackMatch = { stack: githubStack, kind: 'branch', prNumber: 12 };

    const result = prStackFromGithubStack(githubStack, [], match, resolveUrl);

    assert.strictEqual(result.nodes[0].title, 'PR #12');
    assert.strictEqual(result.nodes[0].url, 'https://github.com/org/repo/pull/12');
  });

  it('carries state/draft straight from the stack member, not the open-PR list', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid', { draft: true })]);
    const match: StackMatch = { stack: githubStack, kind: 'branch', prNumber: 12 };

    const result = prStackFromGithubStack(githubStack, [pr(12, 'Mid feature')], match, resolveUrl);

    assert.strictEqual(result.nodes[0].draft, true);
    assert.strictEqual(result.nodes[0].state, 'open');
    assert.strictEqual(result.nodes[0].status, 'draft');
  });

  it('sets currentIndex to the matching node', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')]);
    const match: StackMatch = { stack: githubStack, kind: 'branch', prNumber: 52 };

    const result = prStackFromGithubStack(githubStack, [], match, resolveUrl);

    assert.strictEqual(result.currentIndex, 1);
  });

  it('sets currentIndex to the matched PR even for a PR-review worktree with a different branch name', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid'), stackPr(52, 'feat/top')]);
    const match: StackMatch = { stack: githubStack, kind: 'prNumber', prNumber: 52 };

    const result = prStackFromGithubStack(githubStack, [], match, resolveUrl);

    assert.strictEqual(result.currentIndex, 1);
  });

  it('sets currentIndex to -1 when the current checkout is the target (no match)', () => {
    const githubStack = stack('target', [stackPr(12, 'feat/mid')]);
    const match: StackMatch = { stack: githubStack, kind: 'target' };

    const result = prStackFromGithubStack(githubStack, [], match, resolveUrl);

    assert.strictEqual(result.currentIndex, -1);
  });

  it('marks a member blocked when a draft/closed member sits below it', () => {
    const githubStack = stack('target', [
      stackPr(12, 'feat/mid', { draft: true }),
      stackPr(52, 'feat/top'),
    ]);
    const match: StackMatch = { stack: githubStack, kind: 'branch', prNumber: 52 };

    const result = prStackFromGithubStack(githubStack, [], match, resolveUrl);

    assert.strictEqual(result.nodes[0].blockedDownstack, false);
    assert.strictEqual(result.nodes[1].blockedDownstack, true);
  });
});
