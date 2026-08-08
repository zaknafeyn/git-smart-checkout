import * as assert from 'assert';

import { buildPrStack } from '../../services/prStack';
import {
  indicatorBranchesOf,
  stackInfoMapOf,
  stackViewFromForest,
  stackViewFromPrStack,
} from '../../services/stackModel';
import { GitHubPR } from '../../types/dataTypes';

function pr(number: number, head: string, base: string): GitHubPR {
  return {
    number,
    title: `Title ${number}`,
    body: '',
    head: { ref: head, sha: 'sha', repo: { full_name: 'org/repo', clone_url: '' } },
    base: { ref: base, repo: { full_name: 'org/repo' } },
    html_url: `https://github.com/org/repo/pull/${number}`,
    state: 'open',
    labels: [],
    assignees: [],
  };
}

describe('stackViewFromPrStack', () => {
  it('marks the current branch and carries PR metadata per branch', () => {
    const prs = [pr(12, 'feat/mid', 'target'), pr(52, 'feat/top', 'feat/mid')];
    const stack = buildPrStack(prs, 'feat/mid')!;

    const view = stackViewFromPrStack(stack, 'feat/mid', '/repo');

    assert.strictEqual(view.source, 'github');
    assert.strictEqual(view.target, 'target');
    assert.strictEqual(view.targetIsCurrent, false);
    assert.deepStrictEqual(
      view.branches.map((b) => [b.branch, b.isCurrent, b.pr?.number]),
      [
        ['feat/mid', true, 12],
        ['feat/top', false, 52],
      ]
    );
  });

  it('marks the target as current when the current branch has no PR of its own', () => {
    const prs = [pr(12, 'feat/mid', 'target')];
    const stack = buildPrStack(prs, 'target')!;

    const view = stackViewFromPrStack(stack, 'target', '/repo');

    assert.strictEqual(view.targetIsCurrent, true);
    assert.ok(view.branches.every((b) => !b.isCurrent));
  });

  it('carries the target ahead/behind through when provided', () => {
    const prs = [pr(12, 'feat/mid', 'target')];
    const stack = buildPrStack(prs, 'feat/mid')!;

    const view = stackViewFromPrStack(stack, 'feat/mid', '/repo', { ahead: 1, behind: 3 });

    assert.deepStrictEqual(view.targetAheadBehind, { ahead: 1, behind: 3 });
  });

  it('leaves the target ahead/behind undefined when omitted', () => {
    const prs = [pr(12, 'feat/mid', 'target')];
    const stack = buildPrStack(prs, 'feat/mid')!;

    const view = stackViewFromPrStack(stack, 'feat/mid', '/repo');

    assert.strictEqual(view.targetAheadBehind, undefined);
  });
});

describe('stackViewFromForest', () => {
  it('builds a heuristic view with trunk as the target and no PR metadata', () => {
    const view = stackViewFromForest(['feat/a', 'feat/b'], 'main', 'feat/b', '/repo');

    assert.strictEqual(view.source, 'heuristic');
    assert.strictEqual(view.target, 'main');
    assert.strictEqual(view.targetIsCurrent, false);
    assert.deepStrictEqual(
      view.branches.map((b) => [b.branch, b.isCurrent, b.pr]),
      [
        ['feat/a', false, undefined],
        ['feat/b', true, undefined],
      ]
    );
  });

  it('carries the target ahead/behind through when provided', () => {
    const view = stackViewFromForest(['feat/a', 'feat/b'], 'main', 'feat/b', '/repo', { ahead: 0, behind: 2 });
    assert.deepStrictEqual(view.targetAheadBehind, { ahead: 0, behind: 2 });
  });
});

describe('indicatorBranchesOf', () => {
  it('excludes the target, counting only stack members bottom-to-top', () => {
    const view = stackViewFromForest(['feat/a', 'feat/b'], 'main', 'feat/a', '/repo');
    assert.deepStrictEqual(indicatorBranchesOf(view), ['feat/a', 'feat/b']);
  });

  it('does not include the target even when the target is the current branch', () => {
    const view = stackViewFromForest(['feat/a', 'feat/b'], 'main', 'main', '/repo');
    const branches = indicatorBranchesOf(view);
    assert.strictEqual(branches.includes('main'), false);
  });

  it('counts only PRs for a GitHub-sourced stack, not the target branch', () => {
    const prs = [pr(12, 'feat/mid', 'target'), pr(52, 'feat/top', 'feat/mid')];
    const stack = buildPrStack(prs, 'feat/mid')!;
    const view = stackViewFromPrStack(stack, 'feat/mid', '/repo');

    assert.deepStrictEqual(indicatorBranchesOf(view), ['feat/mid', 'feat/top']);
  });
});

describe('stackInfoMapOf', () => {
  it('maps only branches carrying PR metadata', () => {
    const prs = [pr(12, 'feat/mid', 'target'), pr(52, 'feat/top', 'feat/mid')];
    const stack = buildPrStack(prs, 'feat/mid')!;
    const view = stackViewFromPrStack(stack, 'feat/mid', '/repo');

    const info = stackInfoMapOf(view);

    assert.strictEqual(info.size, 2);
    assert.strictEqual(info.get('feat/mid')?.prNumber, 12);
    assert.strictEqual(info.get('feat/top')?.prTitle, 'Title 52');
  });

  it('is empty for a heuristic view (no PR metadata)', () => {
    const view = stackViewFromForest(['feat/a'], 'main', 'feat/a', '/repo');
    assert.strictEqual(stackInfoMapOf(view).size, 0);
  });
});
