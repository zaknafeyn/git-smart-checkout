import * as assert from 'assert';

import {
  buildIssuesJql,
  DEFAULT_JIRA_ISSUE_FILTER,
  describeJiraIssueFilter,
  JiraIssueFilter,
  normalizeJiraIssueFilter,
} from '../../services/jiraIssueFilter';

describe('jiraIssueFilter', () => {
  describe('buildIssuesJql', () => {
    it('defaults to assigned-to-me with no project/status clause', () => {
      assert.strictEqual(
        buildIssuesJql(DEFAULT_JIRA_ISSUE_FILTER, []),
        'assignee = currentUser() ORDER BY created DESC'
      );
    });

    it('omits the assignee clause for "anyone"', () => {
      const filter: JiraIssueFilter = { assignee: 'anyone', projectKeys: [], status: 'all' };
      assert.strictEqual(buildIssuesJql(filter, []), 'ORDER BY created DESC');
    });

    it('uses assignee IS EMPTY for "unassigned"', () => {
      const filter: JiraIssueFilter = { assignee: 'unassigned', projectKeys: [], status: 'all' };
      assert.strictEqual(buildIssuesJql(filter, []), 'assignee IS EMPTY ORDER BY created DESC');
    });

    it('filter projectKeys override the configured project keys', () => {
      const filter: JiraIssueFilter = { assignee: 'me', projectKeys: ['KEY'], status: 'all' };
      assert.strictEqual(
        buildIssuesJql(filter, ['HOME', 'OTHER']),
        'assignee = currentUser() AND project IN ("KEY") ORDER BY created DESC'
      );
    });

    it('falls back to the configured project keys when the filter has none', () => {
      const filter: JiraIssueFilter = { assignee: 'me', projectKeys: [], status: 'all' };
      assert.strictEqual(
        buildIssuesJql(filter, ['KEY', 'HOME']),
        'assignee = currentUser() AND project IN ("KEY", "HOME") ORDER BY created DESC'
      );
    });

    it('trims, drops empty entries, and uppercases project keys', () => {
      const filter: JiraIssueFilter = { assignee: 'me', projectKeys: ['  key ', '', '  ', 'home'], status: 'all' };
      assert.strictEqual(
        buildIssuesJql(filter, []),
        'assignee = currentUser() AND project IN ("KEY", "HOME") ORDER BY created DESC'
      );
    });

    it('adds a statusCategory clause for each status option', () => {
      const base: Omit<JiraIssueFilter, 'status'> = { assignee: 'anyone', projectKeys: [] };
      assert.strictEqual(
        buildIssuesJql({ ...base, status: 'todo' }, []),
        'statusCategory = "To Do" ORDER BY created DESC'
      );
      assert.strictEqual(
        buildIssuesJql({ ...base, status: 'inProgress' }, []),
        'statusCategory = "In Progress" ORDER BY created DESC'
      );
      assert.strictEqual(
        buildIssuesJql({ ...base, status: 'done' }, []),
        'statusCategory = "Done" ORDER BY created DESC'
      );
    });

    it('combines assignee, project, and status clauses', () => {
      const filter: JiraIssueFilter = { assignee: 'unassigned', projectKeys: ['KEY'], status: 'inProgress' };
      assert.strictEqual(
        buildIssuesJql(filter, []),
        'assignee IS EMPTY AND project IN ("KEY") AND statusCategory = "In Progress" ORDER BY created DESC'
      );
    });

    describe('customJql', () => {
      it('replaces the generated clauses entirely', () => {
        assert.strictEqual(
          buildIssuesJql(DEFAULT_JIRA_ISSUE_FILTER, ['KEY'], 'project = KEY AND issuetype = Epic'),
          'project = KEY AND issuetype = Epic ORDER BY created DESC'
        );
      });

      it('does not append ORDER BY when the custom query already has one', () => {
        assert.strictEqual(
          buildIssuesJql(DEFAULT_JIRA_ISSUE_FILTER, [], 'project = KEY ORDER BY updated DESC'),
          'project = KEY ORDER BY updated DESC'
        );
      });

      it('detects a lowercase "order by" too', () => {
        assert.strictEqual(
          buildIssuesJql(DEFAULT_JIRA_ISSUE_FILTER, [], 'project = KEY order by updated desc'),
          'project = KEY order by updated desc'
        );
      });

      it('ignores whitespace-only custom JQL', () => {
        assert.strictEqual(
          buildIssuesJql(DEFAULT_JIRA_ISSUE_FILTER, [], '   '),
          'assignee = currentUser() ORDER BY created DESC'
        );
      });
    });
  });

  describe('normalizeJiraIssueFilter', () => {
    it('returns the default for undefined/null', () => {
      assert.deepStrictEqual(normalizeJiraIssueFilter(undefined), DEFAULT_JIRA_ISSUE_FILTER);
      assert.deepStrictEqual(normalizeJiraIssueFilter(null), DEFAULT_JIRA_ISSUE_FILTER);
    });

    it('falls back to defaults for unknown assignee/status values', () => {
      assert.deepStrictEqual(
        normalizeJiraIssueFilter({ assignee: 'bogus', status: 'bogus', projectKeys: [] }),
        DEFAULT_JIRA_ISSUE_FILTER
      );
    });

    it('falls back to defaults for a non-array projectKeys', () => {
      assert.deepStrictEqual(
        normalizeJiraIssueFilter({ assignee: 'me', status: 'all', projectKeys: 'KEY' }),
        DEFAULT_JIRA_ISSUE_FILTER
      );
    });

    it('preserves a valid filter', () => {
      const filter = { assignee: 'unassigned', projectKeys: ['KEY'], status: 'done' };
      assert.deepStrictEqual(normalizeJiraIssueFilter(filter), filter);
    });
  });

  describe('describeJiraIssueFilter', () => {
    it('describes the default filter', () => {
      assert.strictEqual(describeJiraIssueFilter(DEFAULT_JIRA_ISSUE_FILTER, []), 'assigned to me');
    });

    it('describes a fully-narrowed filter, falling back to config project keys', () => {
      const filter: JiraIssueFilter = { assignee: 'unassigned', projectKeys: [], status: 'done' };
      assert.strictEqual(
        describeJiraIssueFilter(filter, ['KEY', 'HOME']),
        'unassigned · KEY, HOME · Done'
      );
    });

    it('prefers the filter project keys over the configured ones', () => {
      const filter: JiraIssueFilter = { assignee: 'anyone', projectKeys: ['KEY'], status: 'all' };
      assert.strictEqual(describeJiraIssueFilter(filter, ['HOME']), 'any assignee · KEY');
    });
  });
});
