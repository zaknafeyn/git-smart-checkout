import * as assert from 'assert';

import {
  compareJiraIssuesForPicker,
  createJiraClient,
  isJiraConfigured,
  normalizeJiraDomain,
  sortJiraIssuesForPicker,
} from '../../services/jiraService';

describe('jiraService helpers', () => {
  describe('isJiraConfigured', () => {
    it('returns false when any field is missing', () => {
      assert.strictEqual(
        isJiraConfigured({ domain: '', email: 'a@b.com', token: 'x' }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', email: '', token: 'x' }),
        false
      );
      assert.strictEqual(
        isJiraConfigured({ domain: 'c.atlassian.net', email: 'a@b.com', token: '  ' }),
        false
      );
    });

    it('returns true when domain, email, and token are set', () => {
      assert.strictEqual(
        isJiraConfigured({
          domain: 'company.atlassian.net',
          email: 'user@example.com',
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
        createJiraClient({ domain: '', email: '', token: '' }),
        undefined
      );
    });
  });

  describe('issue picker sorting', () => {
    it('places In Review (unknown category) after In Progress', () => {
      const issues = [
        { key: 'X-1', summary: '', statusName: 'In Review', statusCategoryKey: 'unknown' },
        { key: 'Y-1', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate' },
      ];
      const sorted = sortJiraIssuesForPicker(issues);
      assert.deepStrictEqual(sorted.map((i) => i.key), ['Y-1', 'X-1']);
    });

    it('sorts keys within the same status category', () => {
      assert.ok(
        compareJiraIssuesForPicker(
          { key: 'PROJ-9', summary: '', statusName: 'To Do', statusCategoryKey: 'new' },
          { key: 'PROJ-2', summary: '', statusName: 'To Do', statusCategoryKey: 'new' }
        ) > 0
      );
    });
  });
});
