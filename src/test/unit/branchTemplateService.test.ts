import * as assert from 'assert';

import {
  branchTemplateNeedsJira,
  formatJiraTitle,
  parseJiraTitleTokenArgs,
  resolveBranchTemplate,
  resolveBranchTemplateWithTrace,
  ScriptTokenError,
  BranchTemplateContext,
} from '../../services/branchTemplateService';
import { sortJiraIssuesForPicker } from '../../services/jiraService';

const WORKSPACE = '/workspace';

function makeLogger(): { warnings: string[]; info: () => void; warn: (msg: string) => void; debug: () => void } {
  const warnings: string[] = [];
  return {
    warnings,
    info: () => {},
    warn: (msg: string) => warnings.push(msg),
    debug: () => {},
  };
}

function makeBranchCtx(overrides: Partial<BranchTemplateContext> = {}): BranchTemplateContext {
  return {
    workspaceRoot: WORKSPACE,
    getCurrentBranch: async () => 'main',
    branchExists: async () => false,
    logger: makeLogger(),
    ...overrides,
  };
}

describe('branchTemplateService', () => {
  describe('branchTemplateNeedsJira', () => {
    it('detects jira-key token', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{jira-key}'), true);
    });

    it('detects jira-title token with args', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{jira-title:25:-}'), true);
    });

    it('detects bare jira-title token', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{jira-title}'), true);
    });

    it('returns false when no jira tokens', () => {
      assert.strictEqual(branchTemplateNeedsJira('feat/{r:1}'), false);
      assert.strictEqual(branchTemplateNeedsJira(''), false);
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

    it('returns empty options for empty args', () => {
      assert.deepStrictEqual(parseJiraTitleTokenArgs(''), { limit: undefined, separator: undefined });
    });

    it('ignores non-positive limit', () => {
      assert.deepStrictEqual(parseJiraTitleTokenArgs('0:-'), { limit: undefined, separator: '-' });
      assert.deepStrictEqual(parseJiraTitleTokenArgs('abc:-'), { limit: undefined, separator: '-' });
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

    it('defaults separator to hyphen when omitted', () => {
      assert.strictEqual(formatJiraTitle('A B C'), 'a-b-c');
    });

    it('returns empty string for symbols-only title', () => {
      assert.strictEqual(formatJiraTitle('[!!!]'), '');
    });

    it('trims trailing separator after limit truncation', () => {
      const slug = formatJiraTitle('one two three four', { limit: 7, separator: '-' });
      assert.ok(!slug.endsWith('-'));
      assert.ok(slug.length <= 7);
    });
  });

  describe('resolveBranchTemplate', () => {
    it('resolves full Jira template with retry (documented example)', async () => {
      const title = '[UI] Implement modal dialog with email retry';
      const slug = formatJiraTitle(title, { limit: 25, separator: '-' });
      const base = `vradchuk/KEY-123-${slug}`;
      const existing = new Set([base, `${base}-1`, `${base}-2`]);

      const result = await resolveBranchTemplate(
        'vradchuk/{jira-key}-{jira-title:25:-}{r:1:-}',
        makeBranchCtx({
          jiraKey: 'key-123',
          jiraTitle: title,
          branchExists: async (name) => existing.has(name.toLowerCase()) || existing.has(name),
        })
      );

      assert.strictEqual(result.branch, `${base}-3`.toLowerCase().replace('key-123', 'KEY-123'));
      assert.strictEqual(result.recurringValueUsed, 3);
      // bare probe + 1 + 2 + 3
      assert.strictEqual(result.recurringAttempts, 4);
    });

    it('inserts uppercase jira key and lowercases the rest', async () => {
      const result = await resolveBranchTemplate('VRADCHUK/{jira-key}-Title', makeBranchCtx({
        jiraKey: 'key-123',
        jiraTitle: 'Title',
      }));
      assert.strictEqual(result.branch, 'vradchuk/KEY-123-title');
    });

    it('uppercases jira key when it appears twice in the template', async () => {
      const result = await resolveBranchTemplate('{jira-key}/copy-{jira-key}', makeBranchCtx({
        jiraKey: 'proj-9',
      }));
      assert.strictEqual(result.branch, 'PROJ-9/copy-PROJ-9');
    });

    it('formats jira title with limit and separator', async () => {
      const result = await resolveBranchTemplate('{jira-key}-{jira-title:10:_}', makeBranchCtx({
        jiraKey: 'PROJ-1',
        jiraTitle: 'Some Text to convert',
      }));
      assert.strictEqual(result.branch, 'PROJ-1-some_text');
    });

    it('resolves bare {jira-title} with default hyphen slug', async () => {
      const result = await resolveBranchTemplate('{jira-key}-{jira-title}', makeBranchCtx({
        jiraKey: 'ABC-1',
        jiraTitle: 'Hello World',
      }));
      assert.strictEqual(result.branch, 'ABC-1-hello-world');
    });

    it('leaves empty jira key and warns when issue was not selected', async () => {
      const logger = makeLogger();
      const result = await resolveBranchTemplate('pre-{jira-key}-post', makeBranchCtx({ logger }));
      assert.strictEqual(result.branch, 'pre--post');
      assert.ok(logger.warnings.some((w) => w.includes('no Jira issue was selected')));
    });

    it('leaves empty jira title and warns when summary is missing', async () => {
      const logger = makeLogger();
      const result = await resolveBranchTemplate('{jira-key}-{jira-title:10}', makeBranchCtx({
        jiraKey: 'X-1',
        logger,
      }));
      assert.strictEqual(result.branch, 'X-1-');
      assert.ok(logger.warnings.some((w) => w.includes('no Jira issue title')));
    });

    it('auto-increments recurring token when branch exists', async () => {
      const existing = new Set(['branch', 'branch-1', 'branch-2']);
      const result = await resolveBranchTemplate('branch{r:1:-}', makeBranchCtx({
        branchExists: async (name) => existing.has(name),
      }));
      assert.strictEqual(result.branch, 'branch-3');
      assert.strictEqual(result.recurringValueUsed, 3);
    });

    it('uses the bare branch name when it is available', async () => {
      const result = await resolveBranchTemplate('release{r:5:-}', makeBranchCtx());
      assert.strictEqual(result.branch, 'release');
      assert.strictEqual(result.recurringValueUsed, undefined);
      assert.strictEqual(result.hadRecurringToken, true);
    });

    it('{r:5:-} starts at 5 when the bare branch name is taken', async () => {
      const result = await resolveBranchTemplate('release{r:5:-}', makeBranchCtx({
        branchExists: async (name) => name === 'release',
      }));
      assert.strictEqual(result.branch, 'release-5');
      assert.strictEqual(result.recurringValueUsed, 5);
    });

    it('returns branch unchanged when no {r} token is present', async () => {
      const result = await resolveBranchTemplate('static-branch', makeBranchCtx());
      assert.strictEqual(result.branch, 'static-branch');
      assert.strictEqual(result.recurringAttempts, 0);
      assert.strictEqual(result.recurringValueUsed, undefined);
      assert.strictEqual(result.hadRecurringToken, false);
    });

    it('throws when recurring iteration cap is reached', async () => {
      await assert.rejects(
        () => resolveBranchTemplate('b-{r:1}', makeBranchCtx({ branchExists: async () => true })),
        /Could not find available tag/
      );
    });

    it('resolves file token from workspace JSON', async () => {
      const result = await resolveBranchTemplate('release-{f:package.json:.version}', makeBranchCtx({
        readFile: async () => JSON.stringify({ version: '4.2.0' }),
        realpath: async (p) => p,
      }));
      assert.strictEqual(result.branch, 'release-4.2.0');
    });

    it('resolves branch regex token from current branch', async () => {
      const result = await resolveBranchTemplate('x-{b:\\b[A-Z]+-\\d{3,4}\\b}', makeBranchCtx({
        getCurrentBranch: async () => 'feature/FEAT-123-login',
      }));
      assert.strictEqual(result.branch, 'x-feat-123');
    });

    it('resolves branch token to empty string in detached HEAD', async () => {
      const result = await resolveBranchTemplate('x-{b:\\b[A-Z]+-\\d+\\b}', makeBranchCtx({
        getCurrentBranch: async () => '',
      }));
      assert.strictEqual(result.branch, 'x-');
    });

    it('combines Jira, file, branch regex, and recurring tokens', async () => {
      // The existence check runs on the pre-casing-finalized candidate (uppercase regex match).
      const existing = new Set<string>(['FEAT-1-1.0-FEAT-99']);
      const result = await resolveBranchTemplate(
        '{jira-key}-{f:package.json:.version}-{b:\\b[A-Z]+-\\d+\\b}{r:1:-}',
        makeBranchCtx({
          jiraKey: 'FEAT-1',
          getCurrentBranch: async () => 'feature/FEAT-99-extra',
          readFile: async () => JSON.stringify({ version: '1.0' }),
          realpath: async (p) => p,
          branchExists: async (name) => existing.has(name),
        })
      );
      assert.strictEqual(result.branch, 'FEAT-1-1.0-feat-99-1');
    });

    it('lowercases script and file output while keeping jira key uppercase', async () => {
      const result = await resolveBranchTemplate('{jira-key}-{s:stdout:./suffix.sh}', makeBranchCtx({
        jiraKey: 'ABC-2',
        realpath: async (p) => p,
        runScript: async () => ({ stdout: 'CUSTOM', stderr: '', exitCode: 0 }),
      }));
      assert.strictEqual(result.branch, 'ABC-2-custom');
    });

    it('throws ScriptTokenError when script fails', async () => {
      await assert.rejects(
        () =>
          resolveBranchTemplate('b-{s:stdout:./fail.sh}', makeBranchCtx({
            realpath: async (p) => p,
            runScript: async () => ({ stdout: '', stderr: 'err', exitCode: 1 }),
          })),
        (e: unknown) => {
          assert.ok(e instanceof ScriptTokenError);
          assert.strictEqual(e.scriptPath, './fail.sh');
          return true;
        }
      );
    });

    it('does not call branchExists after script failure', async () => {
      const branchExistsCalls: string[] = [];
      await assert.rejects(
        () =>
          resolveBranchTemplate('b-{s:stdout:./fail.sh}-{r:1}', makeBranchCtx({
            realpath: async (p) => p,
            runScript: async () => ({ stdout: '', stderr: 'boom', exitCode: 2 }),
            branchExists: async (name) => {
              branchExistsCalls.push(name);
              return false;
            },
          })),
        (e: unknown) => e instanceof ScriptTokenError
      );
      assert.strictEqual(branchExistsCalls.length, 0);
    });

    it('warns and resolves unsafe file path to empty', async () => {
      const logger = makeLogger();
      const result = await resolveBranchTemplate('b-{f:../package.json:.version}', makeBranchCtx({
        logger,
      }));
      assert.strictEqual(result.branch, 'b-');
      assert.ok(logger.warnings.some((w) => w.includes('Unsafe file path')));
    });
  });

  describe('resolveBranchTemplateWithTrace', () => {
    // Mirrors the tagTemplateService coverage: the preview command must
    // exercise the exact same resolution logic as resolveBranchTemplate
    // (single source of truth), so resolveBranchTemplate is expected to be a
    // thin wrapper that discards the .tokens trace.

    it('produces the same .branch as resolveBranchTemplate for a full Jira + file + recurring template', async () => {
      const makeFixtureCtx = () =>
        makeBranchCtx({
          jiraKey: 'FEAT-1',
          getCurrentBranch: async () => 'feature/FEAT-99-extra',
          readFile: async () => JSON.stringify({ version: '1.0' }),
          realpath: async (p) => p,
          branchExists: async (name) => name === 'FEAT-1-1.0-FEAT-99',
        });
      const template = '{jira-key}-{f:package.json:.version}-{b:\\b[A-Z]+-\\d+\\b}{r:1:-}';

      const viaResolve = await resolveBranchTemplate(template, makeFixtureCtx());
      const viaTrace = await resolveBranchTemplateWithTrace(template, makeFixtureCtx());

      assert.strictEqual(viaTrace.branch, viaResolve.branch);
      assert.strictEqual(viaTrace.branch, 'FEAT-1-1.0-feat-99-1');
    });

    it('includes a trace entry for the {jira-key} token when resolved', async () => {
      const result = await resolveBranchTemplateWithTrace(
        '{jira-key}/copy',
        makeBranchCtx({ jiraKey: 'proj-9' })
      );
      const jiraTrace = result.tokens.find((t) => t.raw === '{jira-key}');
      assert.strictEqual(jiraTrace?.value, 'PROJ-9');
      assert.strictEqual(jiraTrace?.error, undefined);
    });

    it('Jira token without Jira configured: needs-setup marker, no thrown error', async () => {
      const logger = makeLogger();
      const result = await resolveBranchTemplateWithTrace('pre-{jira-key}-post', makeBranchCtx({
        logger,
        jiraConfigured: false,
      }));
      assert.strictEqual(result.branch, 'pre--post');
      const jiraTrace = result.tokens.find((t) => t.raw === '{jira-key}');
      assert.strictEqual(jiraTrace?.value, '');
      assert.ok(jiraTrace?.error?.includes('needs Jira setup'));
    });

    it('Jira title token without Jira configured also gets the needs-setup marker', async () => {
      const result = await resolveBranchTemplateWithTrace('{jira-key}-{jira-title}', makeBranchCtx({
        jiraKey: 'X-1',
        jiraConfigured: false,
      }));
      const titleTrace = result.tokens.find((t) => t.raw === '{jira-title}');
      assert.ok(titleTrace?.error?.includes('needs Jira setup'));
    });

    it('when Jira IS configured but no issue was picked, uses the legacy "no issue selected" message (not needs-setup)', async () => {
      const result = await resolveBranchTemplateWithTrace('pre-{jira-key}-post', makeBranchCtx());
      const jiraTrace = result.tokens.find((t) => t.raw === '{jira-key}');
      assert.ok(jiraTrace?.error?.includes('no Jira issue selected'));
    });

    it('per-token independence: a failing script token does not prevent the {r} token from resolving', async () => {
      const result = await resolveBranchTemplateWithTrace(
        'b-{s:stdout:./fail.sh}-{r:1}',
        makeBranchCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: '', stderr: 'boom', exitCode: 2 }),
          branchExists: async () => false,
        }),
        { abortOnScriptError: false }
      );
      const scriptTrace = result.tokens.find((t) => t.raw === '{s:stdout:./fail.sh}');
      assert.ok(scriptTrace?.error);
      assert.strictEqual(result.hadRecurringToken, true);
    });

    it('multi-root: resolves {f:...} against ctx.workspaceRoot for the selected repo, not a different root', async () => {
      const readCalls: string[] = [];
      const result = await resolveBranchTemplateWithTrace(
        'release-{f:package.json:.version}',
        makeBranchCtx({
          workspaceRoot: '/repos/repo-b',
          readFile: async (p) => {
            readCalls.push(p);
            return JSON.stringify({ version: '5.5.5' });
          },
          realpath: async (p) => p,
        })
      );
      assert.strictEqual(result.branch, 'release-5.5.5');
      assert.ok(readCalls[0].startsWith('/repos/repo-b'));
    });
  });
});

describe('jiraService sorting', () => {
  it('falls back to key order when issues have no created date', () => {
    const issues = [
      { key: 'B-2', summary: '', statusName: 'Done', statusCategoryKey: 'done', created: '' },
      { key: 'A-3', summary: '', statusName: 'In Progress', statusCategoryKey: 'indeterminate', created: '' },
      { key: 'A-1', summary: '', statusName: 'To Do', statusCategoryKey: 'new', created: '' },
    ];

    const sorted = sortJiraIssuesForPicker(issues);
    assert.deepStrictEqual(sorted.map((i) => i.key), ['A-1', 'A-3', 'B-2']);
  });
});
