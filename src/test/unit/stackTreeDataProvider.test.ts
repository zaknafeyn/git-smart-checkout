import * as assert from 'assert';

import { StackBranchTreeItem, StackGroupTreeItem } from '../../view/StackTreeDataProvider';

describe('StackBranchTreeItem', () => {
  it('renders a pending state before enrichment resolves', () => {
    const item = new StackBranchTreeItem('feat/ui', 'feat/api', '/repo', false);

    assert.strictEqual(item.label, 'feat/ui');
    assert.strictEqual(item.description, '');
    assert.strictEqual(item.contextValue, 'stackBranch');
  });

  it('marks the current branch and tags needs-restack / hasPr', () => {
    const item = new StackBranchTreeItem('feat/ui', 'feat/api', '/repo', true);
    item.applyEnrichment({ prNumber: 311, prState: 'open', ahead: 0, behind: 2, needsRestack: true });

    assert.strictEqual(item.description, 'PR #311  ⇡0 ⇣2  • needs restack');
    assert.strictEqual(item.contextValue, 'stackBranch current needsRestack hasPr');
    assert.ok(String(item.tooltip).includes('Needs restack: yes'));
  });

  it('shows "no PR" once enriched with no matching pull request', () => {
    const item = new StackBranchTreeItem('feat/docs', 'feat/ui', '/repo', false);
    item.applyEnrichment({ ahead: 1, behind: 0, needsRestack: false });

    assert.ok(String(item.description).includes('no PR'));
    assert.strictEqual(item.contextValue, 'stackBranch');
  });
});

describe('StackGroupTreeItem', () => {
  it('labels the group by its root branch and shows a branch count', () => {
    const branches = [
      new StackBranchTreeItem('feat/api', 'feat/api', '/repo', false),
      new StackBranchTreeItem('feat/ui', 'feat/api', '/repo', false),
    ];
    const group = new StackGroupTreeItem('feat/api', branches);

    assert.strictEqual(group.label, 'stack: feat/api');
    assert.strictEqual(group.description, '(2 branches)');
    assert.strictEqual(group.contextValue, 'stackGroup');
  });

  it('uses singular "branch" for a 1-item stack', () => {
    const group = new StackGroupTreeItem('feat/api', [
      new StackBranchTreeItem('feat/api', 'feat/api', '/repo', false),
    ]);
    assert.strictEqual(group.description, '(1 branch)');
  });
});
