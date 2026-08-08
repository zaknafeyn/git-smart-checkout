import * as assert from 'assert';
import * as vscode from 'vscode';

import { buildFilterQuickPickItems } from '../../services/jiraIssueFilterPicker';
import { DEFAULT_JIRA_ISSUE_FILTER, JiraIssueFilter } from '../../services/jiraIssueFilter';

describe('buildFilterQuickPickItems', () => {
  it('shows a single explanatory item when custom JQL is active', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, ['KEY'], true);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, 'Custom JQL is active');
    assert.strictEqual(items[0].apply, undefined);
  });

  it('groups assignee, project, and status options behind separators', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, ['KEY', 'HOME'], false);

    const separators = items.filter((i) => i.kind === vscode.QuickPickItemKind.Separator);
    assert.deepStrictEqual(separators.map((s) => s.label), ['Assignee', 'Project', 'Status']);

    const selectable = items.filter((i) => i.kind !== vscode.QuickPickItemKind.Separator);
    // 3 assignee options + (1 "all configured" + 2 project keys) + 4 status options
    assert.strictEqual(selectable.length, 3 + 3 + 4);
  });

  it('marks the active option in each group with a check', () => {
    const filter: JiraIssueFilter = { assignee: 'unassigned', projectKeys: ['KEY'], status: 'done' };
    const items = buildFilterQuickPickItems(filter, ['KEY', 'HOME'], false);

    const checked = items.filter((i) => i.description === '$(check)');
    assert.strictEqual(checked.length, 3);
    assert.ok(checked.some((i) => i.label.includes('Unassigned')));
    assert.ok(checked.some((i) => i.label.includes('KEY')));
    assert.ok(checked.some((i) => i.label.includes('Done')));
  });

  it('marks "All configured" as active when the filter has no project keys', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, ['KEY'], false);
    const allConfigured = items.find((i) => i.label.includes('All configured'));
    assert.strictEqual(allConfigured?.description, '$(check)');
  });

  it('lists a row per available project key', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, ['KEY', 'HOME'], false);
    assert.ok(items.some((i) => i.label.includes('KEY')));
    assert.ok(items.some((i) => i.label.includes('HOME')));
  });

  it('apply() on an assignee item updates only the assignee field', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, [], false);
    const anyone = items.find((i) => i.label.includes('Anyone'));
    const next = anyone?.apply?.(DEFAULT_JIRA_ISSUE_FILTER);
    assert.deepStrictEqual(next, { ...DEFAULT_JIRA_ISSUE_FILTER, assignee: 'anyone' });
  });

  it('apply() on a project item narrows to that single key', () => {
    const items = buildFilterQuickPickItems(DEFAULT_JIRA_ISSUE_FILTER, ['KEY', 'HOME'], false);
    const home = items.find((i) => i.label.includes('HOME'));
    const next = home?.apply?.(DEFAULT_JIRA_ISSUE_FILTER);
    assert.deepStrictEqual(next?.projectKeys, ['HOME']);
  });
});
