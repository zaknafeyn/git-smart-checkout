import * as assert from 'assert';

import { PrStack, StackCheckoutIdentity } from '../../services/prStack';
import { indicatorBranchesOf, stackInfoMapOf, stackViewFromPrStack } from '../../services/stackModel';

/** Builds a `PrStack` fixture directly — order/target come from GitHub's Stacks API, not a local walk. */
function makeStack(
  entries: Array<{ branch: string; prNumber: number; title: string }>,
  target: string,
  currentBranch: string
): PrStack {
  return {
    nodes: entries.map((e) => ({
      branch: e.branch,
      prNumber: e.prNumber,
      title: e.title,
      url: `https://github.com/org/repo/pull/${e.prNumber}`,
      state: 'open',
      status: 'open',
      blockedDownstack: false,
    })),
    target,
    currentIndex: entries.findIndex((e) => e.branch === currentBranch),
  };
}

function identity(branch: string): StackCheckoutIdentity {
  return { branch };
}

describe('stackViewFromPrStack', () => {
  it('marks the current branch and carries PR metadata per branch', () => {
    const stack = makeStack(
      [
        { branch: 'feat/mid', prNumber: 12, title: 'Title 12' },
        { branch: 'feat/top', prNumber: 52, title: 'Title 52' },
      ],
      'target',
      'feat/mid'
    );

    const view = stackViewFromPrStack(stack, identity('feat/mid'), '/repo');

    assert.strictEqual(view.target, 'target');
    assert.strictEqual(view.targetIsCurrent, false);
    assert.strictEqual(view.currentIndex, 0);
    assert.deepStrictEqual(
      view.branches.map((b) => [b.branch, b.isCurrent, b.pr.number]),
      [
        ['feat/mid', true, 12],
        ['feat/top', false, 52],
      ]
    );
  });

  it('marks the target as current when the current branch has no PR of its own', () => {
    const stack = makeStack([{ branch: 'feat/mid', prNumber: 12, title: 'Title 12' }], 'target', 'target');

    const view = stackViewFromPrStack(stack, identity('target'), '/repo');

    assert.strictEqual(view.targetIsCurrent, true);
    assert.strictEqual(view.currentIndex, -1);
    assert.ok(view.branches.every((b) => !b.isCurrent));
  });

  it('carries the target ahead/behind through when provided', () => {
    const stack = makeStack([{ branch: 'feat/mid', prNumber: 12, title: 'Title 12' }], 'target', 'feat/mid');

    const view = stackViewFromPrStack(stack, identity('feat/mid'), '/repo', { ahead: 1, behind: 3 });

    assert.deepStrictEqual(view.targetAheadBehind, { ahead: 1, behind: 3 });
  });

  it('leaves the target ahead/behind undefined when omitted', () => {
    const stack = makeStack([{ branch: 'feat/mid', prNumber: 12, title: 'Title 12' }], 'target', 'feat/mid');

    const view = stackViewFromPrStack(stack, identity('feat/mid'), '/repo');

    assert.strictEqual(view.targetAheadBehind, undefined);
  });

  it('marks the current branch even when the identity has no branch (detached HEAD matched by sha)', () => {
    const stack = makeStack([{ branch: 'feat/mid', prNumber: 12, title: 'Title 12' }], 'target', 'feat/mid');

    const view = stackViewFromPrStack(stack, { headSha: 'sha-12' }, '/repo');

    assert.strictEqual(view.currentIndex, 0);
    assert.strictEqual(view.branches[0].isCurrent, true);
    assert.strictEqual(view.targetIsCurrent, false);
  });

  it('propagates status and blockedDownstack per branch', () => {
    const stack: PrStack = {
      nodes: [
        {
          branch: 'feat/mid',
          prNumber: 12,
          title: 'Title 12',
          url: 'https://github.com/org/repo/pull/12',
          state: 'open',
          draft: true,
          status: 'draft',
          blockedDownstack: false,
        },
        {
          branch: 'feat/top',
          prNumber: 52,
          title: 'Title 52',
          url: 'https://github.com/org/repo/pull/52',
          state: 'open',
          status: 'open',
          blockedDownstack: true,
        },
      ],
      target: 'target',
      currentIndex: 1,
    };

    const view = stackViewFromPrStack(stack, identity('feat/top'), '/repo');

    assert.strictEqual(view.branches[0].pr.status, 'draft');
    assert.strictEqual(view.branches[0].pr.blockedDownstack, false);
    assert.strictEqual(view.branches[1].pr.status, 'open');
    assert.strictEqual(view.branches[1].pr.blockedDownstack, true);
  });
});

describe('indicatorBranchesOf', () => {
  it('excludes the target, counting only stacked PRs bottom-to-top', () => {
    const stack = makeStack(
      [
        { branch: 'feat/mid', prNumber: 12, title: 'Title 12' },
        { branch: 'feat/top', prNumber: 52, title: 'Title 52' },
      ],
      'target',
      'feat/mid'
    );
    const view = stackViewFromPrStack(stack, identity('feat/mid'), '/repo');

    assert.deepStrictEqual(indicatorBranchesOf(view), ['feat/mid', 'feat/top']);
  });
});

describe('stackInfoMapOf', () => {
  it('maps every branch to its PR metadata', () => {
    const stack = makeStack(
      [
        { branch: 'feat/mid', prNumber: 12, title: 'Title 12' },
        { branch: 'feat/top', prNumber: 52, title: 'Title 52' },
      ],
      'target',
      'feat/mid'
    );
    const view = stackViewFromPrStack(stack, identity('feat/mid'), '/repo');

    const info = stackInfoMapOf(view);

    assert.strictEqual(info.size, 2);
    assert.strictEqual(info.get('feat/mid')?.prNumber, 12);
    assert.strictEqual(info.get('feat/top')?.prTitle, 'Title 52');
  });
});
