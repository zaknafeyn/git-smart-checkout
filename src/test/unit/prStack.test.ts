import * as assert from 'assert';

import { buildPrStack } from '../../services/prStack';
import { GitHubPR } from '../../types/dataTypes';

let nextNumber = 1;

function pr(
  head: string,
  base: string,
  opts: Partial<GitHubPR> = {}
): GitHubPR {
  const number = opts.number ?? nextNumber++;
  return {
    number,
    title: opts.title ?? `PR for ${head}`,
    body: '',
    head: { ref: head, sha: 'sha', repo: { full_name: 'org/repo', clone_url: '' } },
    base: { ref: base, repo: { full_name: 'org/repo' } },
    html_url: `https://github.com/org/repo/pull/${number}`,
    state: opts.state ?? 'open',
    labels: [],
    assignees: [],
    ...opts,
  };
}

beforeEach(() => {
  nextNumber = 1;
});

// gh-mindsight fixture: #12 test/feature-1-for-release-v1 -> test/fake-release-v1
//                        #52 vradchuk/feature-1-for-release-v1.1 -> test/feature-1-for-release-v1
function ghMindsightChain(): GitHubPR[] {
  return [
    pr('test/feature-1-for-release-v1', 'test/fake-release-v1', { number: 12 }),
    pr('vradchuk/feature-1-for-release-v1.1', 'test/feature-1-for-release-v1', { number: 52 }),
  ];
}

describe('buildPrStack', () => {
  it('builds the chain from the middle branch (currentIndex 0)', () => {
    const stack = buildPrStack(ghMindsightChain(), 'test/feature-1-for-release-v1');
    assert.ok(stack);
    assert.deepStrictEqual(
      stack!.nodes.map((n) => n.prNumber),
      [12, 52]
    );
    assert.strictEqual(stack!.target, 'test/fake-release-v1');
    assert.strictEqual(stack!.currentIndex, 0);
  });

  it('builds the same chain from the top branch (currentIndex 1)', () => {
    const stack = buildPrStack(ghMindsightChain(), 'vradchuk/feature-1-for-release-v1.1');
    assert.ok(stack);
    assert.deepStrictEqual(
      stack!.nodes.map((n) => n.prNumber),
      [12, 52]
    );
    assert.strictEqual(stack!.target, 'test/fake-release-v1');
    assert.strictEqual(stack!.currentIndex, 1);
  });

  it('builds the same chain from the target branch itself (currentIndex -1, no PR of its own)', () => {
    const stack = buildPrStack(ghMindsightChain(), 'test/fake-release-v1');
    assert.ok(stack);
    assert.deepStrictEqual(
      stack!.nodes.map((n) => n.prNumber),
      [12, 52]
    );
    assert.strictEqual(stack!.target, 'test/fake-release-v1');
    assert.strictEqual(stack!.currentIndex, -1);
  });

  it('does not require any chain member to be a known local branch (remote-only branches survive)', () => {
    // No localBranches concept exists at all — this is the regression test.
    const stack = buildPrStack(ghMindsightChain(), 'test/feature-1-for-release-v1', { trunk: 'main' });
    assert.ok(stack);
    assert.strictEqual(stack!.nodes.length, 2);
  });

  it('does not truncate a chain whose bottom PR targets trunk', () => {
    const chain = [pr('feat/a', 'main', { number: 10 }), pr('feat/b', 'feat/a', { number: 11 })];
    const stack = buildPrStack(chain, 'feat/a', { trunk: 'main' });
    assert.ok(stack);
    assert.strictEqual(stack!.nodes.length, 2);
    assert.strictEqual(stack!.target, 'main');
  });

  it('treats a single PR onto trunk as not a stack', () => {
    const stack = buildPrStack([pr('feat/a', 'main', { number: 1 })], 'feat/a', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });

  it('treats a single PR onto a non-trunk base as a stack', () => {
    const stack = buildPrStack([pr('feat/a', 'release/1.0', { number: 1 })], 'feat/a', { trunk: 'main' });
    assert.ok(stack);
    assert.strictEqual(stack!.nodes.length, 1);
    assert.strictEqual(stack!.target, 'release/1.0');
  });

  it('returns undefined when the current branch is trunk', () => {
    const stack = buildPrStack(ghMindsightChain(), 'main', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });

  it('returns undefined when there are no PRs involving the current branch', () => {
    const stack = buildPrStack(ghMindsightChain(), 'unrelated-branch', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });

  it('resolves a fork (two PRs sharing a base) deterministically by lowest PR number', () => {
    const base = [
      pr('feat/base', 'main', { number: 1 }),
      pr('feat/child-b', 'feat/base', { number: 30 }),
      pr('feat/child-a', 'feat/base', { number: 20 }),
    ];
    const stack = buildPrStack(base, 'feat/base', { trunk: 'main' });
    assert.ok(stack);
    assert.deepStrictEqual(stack!.forkedAt, ['feat/base']);
    assert.strictEqual(stack!.nodes[stack!.nodes.length - 1].branch, 'feat/child-a');

    // Stable across shuffled input order.
    const shuffled = [base[2], base[0], base[1]];
    const stackShuffled = buildPrStack(shuffled, 'feat/base', { trunk: 'main' });
    assert.strictEqual(stackShuffled!.nodes[stackShuffled!.nodes.length - 1].branch, 'feat/child-a');
  });

  it('terminates on a cycle without duplicating nodes', () => {
    const cyclePrs = [pr('a', 'b', { number: 1 }), pr('b', 'a', { number: 2 })];
    const stack = buildPrStack(cyclePrs, 'a');
    assert.ok(stack);
    const branchNames = stack!.nodes.map((n) => n.branch);
    assert.strictEqual(new Set(branchNames).size, branchNames.length, 'no duplicate nodes');
  });

  it('skips malformed PRs (missing head/base ref, head === base)', () => {
    const malformed = [
      { ...pr('feat/a', 'main', { number: 1 }), head: { ref: '', sha: '' } } as GitHubPR,
      pr('feat/same', 'feat/same', { number: 2 }),
    ];
    const stack = buildPrStack(malformed, 'feat/a', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });

  it('skips closed PRs', () => {
    const stack = buildPrStack([pr('feat/a', 'main', { number: 1, state: 'closed' })], 'feat/a', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });

  it('skips cross-fork PRs (head repo differs from base repo)', () => {
    const forkPr: GitHubPR = {
      ...pr('feat/a', 'main', { number: 1 }),
      head: { ref: 'feat/a', sha: 'sha', repo: { full_name: 'someoneelse/repo', clone_url: '' } },
      base: { ref: 'main', repo: { full_name: 'org/repo' } },
    };
    const stack = buildPrStack([forkPr], 'feat/a', { trunk: 'main' });
    assert.strictEqual(stack, undefined);
  });
});
