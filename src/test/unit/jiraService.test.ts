import * as assert from 'assert';

import {
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
        }),
        'domain=set, username=set, token=set'
      );
      assert.strictEqual(
        describeJiraConfigFields({ domain: '', username: 'u', token: '' }),
        'domain=missing, username=set, token=missing'
      );
    });
  });

  describe('isJiraConfigured', () => {
    it('returns false when any field is missing', () => {
      assert.strictEqual(
        isJiraConfigured({ domain: '', username: 'a@b.com', token: 'x' }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', username: '', token: 'x' }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', username: 'a@b.com', token: '  ' }),
        false
      );
    });

    it('returns true when domain, username, and token are set', () => {
      assert.strictEqual(
        isJiraConfigured({
          domain: 'company.atlassian.net',
          username: 'user@example.com',
          token: 'secret',
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
        createJiraClient({ domain: '', username: '', token: '' }),
        undefined
      );
    });
  });

  describe('issue picker sorting', () => {
    it('sorts issues by key ascending', () => {
      const issues = [
        { key: 'PROJ-10', summary: '', statusName: 'Done', statusCategoryKey: 'done' },
        { key: 'PROJ-2', summary: '', statusName: 'To Do', statusCategoryKey: 'new' },
        { key: 'PROJ-9', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate' },
      ];
      const sorted = sortJiraIssuesForPicker(issues);
      assert.deepStrictEqual(sorted.map((i) => i.key), ['PROJ-10', 'PROJ-2', 'PROJ-9']);
    });

    it('compareJiraIssuesForPicker orders by key only', () => {
      const a = { key: 'Z-9', summary: '', statusName: 'To Do', statusCategoryKey: 'new' };
      const b = { key: 'A-1', summary: '', statusName: 'Done', statusCategoryKey: 'done' };
      assert.ok(compareJiraIssuesForPicker(a, b) > 0);
    });
  });
});
