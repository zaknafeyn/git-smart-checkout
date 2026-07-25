import * as assert from 'assert';

import {
  resolveBranchTemplateWithTrace,
  BranchTemplateContext,
} from '../../services/branchTemplateService';
import {
  resolveTagTemplateWithTrace,
  TagTemplateContext,
} from '../../services/tagTemplateService';

const WORKSPACE = '/workspace';

function makeLogger() {
  return { info: () => {}, warn: () => {}, debug: () => {} };
}

function makeTagCtx(overrides: Partial<TagTemplateContext> = {}): TagTemplateContext {
  return {
    workspaceRoot: WORKSPACE,
    getCurrentBranch: async () => 'feature/ABC-123',
    tagExists: async () => false,
    logger: makeLogger(),
    ...overrides,
  };
}

function makeBranchCtx(overrides: Partial<BranchTemplateContext> = {}): BranchTemplateContext {
  return {
    workspaceRoot: WORKSPACE,
    getCurrentBranch: async () => 'feature/ABC-123',
    branchExists: async () => false,
    logger: makeLogger(),
    ...overrides,
  };
}

describe('template preview mode', () => {
  describe('tag resolver', () => {
    it('leaves {s:...} script tokens literal without running them', async () => {
      let scriptRan = false;
      const ctx = makeTagCtx({
        runScript: async () => {
          scriptRan = true;
          return { stdout: 'ran', stderr: '', exitCode: 0 };
        },
      });
      const traced = await resolveTagTemplateWithTrace('v-{s:./build.sh}', ctx, { preview: true });
      assert.strictEqual(scriptRan, false);
      assert.strictEqual(traced.tag, 'v-{s:./build.sh}');
    });

    it('leaves the {r} token literal without querying tag existence', async () => {
      let existenceChecked = false;
      const ctx = makeTagCtx({
        tagExists: async () => {
          existenceChecked = true;
          return true;
        },
      });
      const traced = await resolveTagTemplateWithTrace('v1{r:1:-}', ctx, { preview: true });
      assert.strictEqual(existenceChecked, false);
      assert.strictEqual(traced.tag, 'v1{r:1:-}');
      assert.strictEqual(traced.hadRecurringToken, true);
    });

    it('still resolves {b:...} branch-regex tokens', async () => {
      const traced = await resolveTagTemplateWithTrace(
        'tag-{b:[A-Z]+-\\d+}',
        makeTagCtx(),
        { preview: true }
      );
      assert.strictEqual(traced.tag, 'tag-ABC-123');
    });
  });

  describe('branch resolver', () => {
    it('leaves Jira tokens literal when no Jira data is supplied', async () => {
      const traced = await resolveBranchTemplateWithTrace(
        'feat/{jira-key}-{jira-title:20:-}',
        makeBranchCtx(),
        { preview: true }
      );
      assert.strictEqual(traced.branch, 'feat/{jira-key}-{jira-title:20:-}');
    });

    it('resolves Jira tokens when data is available even in preview mode', async () => {
      const traced = await resolveBranchTemplateWithTrace(
        'feat/{jira-key}',
        makeBranchCtx({ jiraKey: 'ABC-1', jiraTitle: 'Fix the thing' }),
        { preview: true }
      );
      assert.strictEqual(traced.branch, 'feat/ABC-1');
    });

    it('leaves scripts and {r} literal but resolves {b:...}', async () => {
      let scriptRan = false;
      const traced = await resolveBranchTemplateWithTrace(
        'feat/{b:[A-Z]+-\\d+}-{s:./v.sh}{r:1:-}',
        makeBranchCtx({
          runScript: async () => {
            scriptRan = true;
            return { stdout: 'x', stderr: '', exitCode: 0 };
          },
        }),
        { preview: true }
      );
      assert.strictEqual(scriptRan, false);
      // {b:...} resolves; the branch regex value is lowercased by finalizeBranchCasing.
      assert.strictEqual(traced.branch, 'feat/abc-123-{s:./v.sh}{r:1:-}');
    });
  });

  describe('non-preview (real) flow is unchanged', () => {
    it('runs the {r} uniqueness loop and drops a free token', async () => {
      const traced = await resolveTagTemplateWithTrace('v1{r:1:-}', makeTagCtx(), {});
      assert.strictEqual(traced.tag, 'v1');
      assert.strictEqual(traced.hadRecurringToken, true);
    });
  });
});
