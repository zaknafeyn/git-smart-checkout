import * as assert from 'assert';

import { JiraConfig } from '../../configuration/extensionConfig';
import {
  compareJiraIssuesForPicker,
  createJiraClient,
  describeJiraConfigFields,
  isJiraConfigured,
  normalizeJiraDomain,
  searchIssuesWithJql,
  sortJiraIssuesForPicker,
} from '../../services/jiraService';

type FakeJiraApiCall = { genericGet: (path: string) => Promise<unknown> };

function makeFakeClient(pages: Array<{ issues: unknown[]; nextPageToken?: string; isLast?: boolean }>) {
  let call = 0;
  const client: FakeJiraApiCall = {
    genericGet: async () => {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return page;
    },
  };
  return { client, callCount: () => call };
}

function makeJiraConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    domain: '',
    username: '',
    token: '',
    projectKeys: [],
    customJql: '',
    ...overrides,
  };
}

describe('jiraService helpers', () => {
  describe('describeJiraConfigFields', () => {
    it('reports which fields are set without exposing values', () => {
      assert.strictEqual(
        describeJiraConfigFields(
          makeJiraConfig({ domain: 'c.atlassian.net', username: 'user@example.com', token: 'secret' })
        ),
        'domain=set, username=set, token=set'
      );
      assert.strictEqual(
        describeJiraConfigFields(makeJiraConfig({ username: 'u' })),
        'domain=missing, username=set, token=missing'
      );
    });
  });

  describe('isJiraConfigured', () => {
    it('returns false when any field is missing', () => {
      assert.strictEqual(
        isJiraConfigured(makeJiraConfig({ username: 'a@b.com', token: 'x' })),
        false
      );
      assert.strictEqual(
        isJiraConfigured(makeJiraConfig({ domain: 'c.atlassian.net', token: 'x' })),
        false
      );
      assert.strictEqual(
        isJiraConfigured(
          makeJiraConfig({ domain: 'c.atlassian.net', username: 'a@b.com', token: '  ' })
        ),
        false
      );
    });

    it('returns true when domain, username, and token are set', () => {
      assert.strictEqual(
        isJiraConfigured(
          makeJiraConfig({
            domain: 'company.atlassian.net',
            username: 'user@example.com',
            token: 'secret',
          })
        ),
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
      assert.strictEqual(createJiraClient(makeJiraConfig()), undefined);
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

  describe('searchIssuesWithJql', () => {
    it('collects issues across pages using nextPageToken', async () => {
      const { client } = makeFakeClient([
        { issues: [{ key: 'A-1' }], nextPageToken: 'p2' },
        { issues: [{ key: 'A-2' }], isLast: true },
      ]);
      const result = await searchIssuesWithJql(client as never, 'ORDER BY created DESC', ['summary']);
      assert.deepStrictEqual(result.issues.map((i) => i.key), ['A-1', 'A-2']);
      assert.strictEqual(result.truncated, false);
    });

    it('stops once maxIssues is reached and reports truncated', async () => {
      const { client, callCount } = makeFakeClient([
        { issues: [{ key: 'A-1' }, { key: 'A-2' }], nextPageToken: 'p2' },
        { issues: [{ key: 'A-3' }, { key: 'A-4' }], nextPageToken: 'p3' },
      ]);
      const result = await searchIssuesWithJql(client as never, 'ORDER BY created DESC', ['summary'], 3);
      assert.deepStrictEqual(result.issues.map((i) => i.key), ['A-1', 'A-2', 'A-3']);
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(callCount(), 2);
    });

    it('does not report truncated when the cap is reached exactly on the last page', async () => {
      const { client } = makeFakeClient([{ issues: [{ key: 'A-1' }, { key: 'A-2' }], isLast: true }]);
      const result = await searchIssuesWithJql(client as never, 'ORDER BY created DESC', ['summary'], 2);
      assert.strictEqual(result.truncated, false);
    });

    it('stops re-serving pages when nextPageToken repeats', async () => {
      const { client, callCount } = makeFakeClient([
        { issues: [{ key: 'A-1' }], nextPageToken: 'p2' },
        { issues: [{ key: 'A-2' }], nextPageToken: 'p2' },
      ]);
      const result = await searchIssuesWithJql(client as never, 'ORDER BY created DESC', ['summary']);
      assert.deepStrictEqual(result.issues.map((i) => i.key), ['A-1', 'A-2']);
      assert.strictEqual(callCount(), 2);
    });
  });
});
