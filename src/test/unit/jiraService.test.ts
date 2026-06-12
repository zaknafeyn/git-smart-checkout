import * as assert from 'assert';

import {
  buildAssignedIssuesJql,
  compareJiraIssuesForPicker,
  createJiraClient,
  describeJiraConfigFields,
  isJiraConfigured,
  normalizeJiraDomain,
  sortJiraIssuesForPicker,
} from '../../services/jiraService';

describe('jiraService helpers', () => {
  describe('describeJiraConfigFields', () => {
    it('reports which fields are set without exposing values', () => {
      assert.strictEqual(
        describeJiraConfigFields({
          domain: 'c.atlassian.net',
          username: 'user@example.com',
          token: 'secret',
          projectKeys: [],
        }),
        'domain=set, username=set, token=set'
      );
      assert.strictEqual(
        describeJiraConfigFields({ domain: '', username: 'u', token: '', projectKeys: [] }),
        'domain=missing, username=set, token=missing'
      );
    });
  });

  describe('isJiraConfigured', () => {
    it('returns false when any field is missing', () => {
      assert.strictEqual(
        isJiraConfigured({ domain: '', username: 'a@b.com', token: 'x', projectKeys: [] }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', username: '', token: 'x', projectKeys: [] }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', username: 'a@b.com', token: '  ', projectKeys: [] }),
        false
      );
    });

    it('returns true when domain, username, and token are set', () => {
      assert.strictEqual(
        isJiraConfigured({
          domain: 'company.atlassian.net',
          username: 'user@example.com',
          token: 'secret',
          projectKeys: [],
        }),
        true
      );
    });
  });

  describe('normalizeJiraDomain', () => {
    it('strips protocol and trailing slashes', () => {
      assert.strictEqual(
        normalizeJiraDomain('https://company.atlassian.net/'),
        'company.atlassian.net'
      );
    });

    it('trims whitespace', () => {
      assert.strictEqual(
        normalizeJiraDomain('  company.atlassian.net  '),
        'company.atlassian.net'
      );
    });
  });

  describe('createJiraClient', () => {
    it('returns undefined when Jira is not configured', () => {
      assert.strictEqual(
        createJiraClient({ domain: '', username: '', token: '', projectKeys: [] }),
        undefined
      );
    });
  });

  describe('buildAssignedIssuesJql', () => {
    it('orders by newest created first with no project filter', () => {
      assert.strictEqual(
        buildAssignedIssuesJql([]),
        'assignee = currentUser() ORDER BY created DESC'
      );
    });

    it('limits to the provided project keys', () => {
      assert.strictEqual(
        buildAssignedIssuesJql(['KEY', 'HOME']),
        'assignee = currentUser() AND project IN ("KEY", "HOME") ORDER BY created DESC'
      );
    });

    it('trims, drops empty entries, and uppercases keys', () => {
      assert.strictEqual(
        buildAssignedIssuesJql(['  key ', '', '  ', 'home']),
        'assignee = currentUser() AND project IN ("KEY", "HOME") ORDER BY created DESC'
      );
    });
  });

  describe('issue picker sorting', () => {
    it('sorts issues by created date descending (newest first)', () => {
      const issues = [
        { key: 'PROJ-2', summary: '', statusName: 'To Do', statusCategoryKey: 'new', created: '2026-01-01T10:00:00.000+0000' },
        { key: 'PROJ-10', summary: '', statusName: 'Done', statusCategoryKey: 'done', created: '2026-03-15T10:00:00.000+0000' },
        { key: 'PROJ-9', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate', created: '2026-02-20T10:00:00.000+0000' },
      ];
      const sorted = sortJiraIssuesForPicker(issues);
      assert.deepStrictEqual(sorted.map((i) => i.key), ['PROJ-10', 'PROJ-9', 'PROJ-2']);
    });

    it('falls back to key order when created dates are missing or equal', () => {
      const issues = [
        { key: 'PROJ-10', summary: '', statusName: 'Done', statusCategoryKey: 'done', created: '' },
        { key: 'PROJ-2', summary: '', statusName: 'To Do', statusCategoryKey: 'new', created: '' },
        { key: 'PROJ-9', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate', created: '' },
      ];
      const sorted = sortJiraIssuesForPicker(issues);
      assert.deepStrictEqual(sorted.map((i) => i.key), ['PROJ-10', 'PROJ-2', 'PROJ-9']);
    });

    it('compareJiraIssuesForPicker orders newer created before older', () => {
      const newer = { key: 'A-1', summary: '', statusName: 'To Do', statusCategoryKey: 'new', created: '2026-05-01T00:00:00.000+0000' };
      const older = { key: 'Z-9', summary: '', statusName: 'Done', statusCategoryKey: 'done', created: '2026-01-01T00:00:00.000+0000' };
      assert.ok(compareJiraIssuesForPicker(newer, older) < 0);
      assert.ok(compareJiraIssuesForPicker(older, newer) > 0);
    });
  });
});
