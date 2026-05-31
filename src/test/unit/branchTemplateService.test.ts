import * as assert from 'assert';

import {
  branchTemplateNeedsJira,
  formatJiraTitle,
  parseJiraTitleTokenArgs,
  resolveBranchTemplate,
} from '../../services/branchTemplateService';
import { compareJiraIssuesForPicker, sortJiraIssuesForPicker } from '../../services/jiraService';

const WORKSPACE = '/workspace';

describe('branchTemplateService', () => {
  describe('branchTemplateNeedsJira', () => {
    it('detects jira-key token', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{jira-key}'), true);
    });

    it('detects jira-title token', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{jira-title:25:-}'), true);
    });

    it('returns false when no jira tokens', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{r:1}'), false);
    });
  });

  describe('parseJiraTitleTokenArgs', () => {
    it('parses limit and separator', () => {
      assert.deepStrictEqual(parseJiraTitleTokenArgs('25:-'), { limit: 25, separator: '-' });
    });

    it('parses limit only', () => {
      assert.deepStrictEqual(parseJiraTitleTokenArgs('25'), { limit: 25, separator: undefined });
    });

    it('parses separator only', () => {
      assert.deepStrictEqual(parseJiraTitleTokenArgs(':_'), { limit: undefined, separator: '_' });
    });
  });

  describe('formatJiraTitle', () => {
    it('converts title to hyphen slug', () => {
      assert.strictEqual(
        formatJiraTitle('[UI] Implement modal dialog with email retry'),
        'ui-implement-modal-dialog-with-email-retry'
      );
    });

    it('respects character limit', () => {
      assert.strictEqual(
        formatJiraTitle('Some Text to convert', { limit: 10 }),
        'some-text'
      );
    });

    it('uses first character of custom separator', () => {
      assert.strictEqual(
        formatJiraTitle('Hello World', { separator: '_#' }),
        'hello_world'
      );
    });
  });

  describe('resolveBranchTemplate', () => {
    it('inserts uppercase jira key and lowercases the rest', async () => {
      const result = await resolveBranchTemplate('VRADCHUK/{jira-key}-Title', {
        workspaceRoot: WORKSPACE,
        jiraKey: 'key-123',
        jiraTitle: 'Title',
        getCurrentBranch: async () => 'main',
        branchExists: async () => false,
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
      });
      assert.strictEqual(result.branch, 'vradchuk/KEY-123-title');
    });

    it('formats jira title with limit and separator', async () => {
      const result = await resolveBranchTemplate('{jira-key}-{jira-title:10:_}', {
        workspaceRoot: WORKSPACE,
        jiraKey: 'PROJ-1',
        jiraTitle: 'Some Text to convert',
        getCurrentBranch: async () => 'main',
        branchExists: async () => false,
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
      });
      assert.strictEqual(result.branch, 'PROJ-1-some_text');
    });

    it('auto-increments recurring token when branch exists', async () => {
      const existing = new Set(['branch-1', 'branch-2']);
      const result = await resolveBranchTemplate('branch-{r:1}', {
        workspaceRoot: WORKSPACE,
        getCurrentBranch: async () => 'main',
        branchExists: async (name) => existing.has(name),
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
      });
      assert.strictEqual(result.branch, 'branch-3');
      assert.strictEqual(result.recurringValueUsed, 3);
    });
  });
});

describe('jiraService sorting', () => {
  it('sorts To Do before In Progress before other statuses, then by key', () => {
    const issues = [
      { key: 'B-2', summary: '', statusName: 'Done', statusCategoryKey: 'done' },
      { key: 'A-3', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate' },
      { key: 'C-1', summary: '', statusName: 'To Do', statusCategoryKey: 'new' },
      { key: 'A-1', summary: '', statusName: 'To Do', statusCategoryKey: 'new' },
    ];

    const sorted = sortJiraIssuesForPicker(issues);
    assert.deepStrictEqual(
      sorted.map((i) => i.key),
      ['A-1', 'C-1', 'A-3', 'B-2']
    );
  });

  it('compareJiraIssuesForPicker orders by category then key', () => {
    const a = { key: 'Z-9', summary: '', statusName: 'To Do', statusCategoryKey: 'new' };
    const b = { key: 'A-1', summary: '', statusName: 'To Do', statusCategoryKey: 'new' };
    assert.ok(compareJiraIssuesForPicker(a, b) > 0);
  });
});
