import * as assert from 'assert';

import {
  resolveTagTemplate,
  isSafeWorkspacePath,
  readJsonDotPath,
  extractFirstRegexMatch,
  ScriptTokenError,
  TagTemplateContext,
  TagTemplateLogger,
} from '../../services/tagTemplateService';

const WORKSPACE = '/workspace';

function makeLogger(): TagTemplateLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info: () => {},
    warn: (msg) => warnings.push(msg),
    debug: () => {},
  };
}

function makeCtx(overrides: Partial<TagTemplateContext> = {}): TagTemplateContext {
  return {
    workspaceRoot: WORKSPACE,
    getCurrentBranch: async () => 'main',
    tagExists: async () => false,
    readFile: async () => '{}',
    logger: makeLogger(),
    ...overrides,
  };
}

describe('tagTemplateService', () => {
  describe('isSafeWorkspacePath', () => {
    it('allows relative paths inside workspace', () => {
      assert.strictEqual(isSafeWorkspacePath('/ws', 'package.json'), true);
      assert.strictEqual(isSafeWorkspacePath('/ws', 'apps/mobile/package.json'), true);
      assert.strictEqual(isSafeWorkspacePath('/ws', './package.json'), true);
    });

    it('rejects absolute paths', () => {
      assert.strictEqual(isSafeWorkspacePath('/ws', '/etc/passwd'), false);
    });

    it('rejects paths containing ..', () => {
      assert.strictEqual(isSafeWorkspacePath('/ws', '../package.json'), false);
      assert.strictEqual(isSafeWorkspacePath('/ws', '../../secret'), false);
    });
  });

  describe('readJsonDotPath', () => {
    it('reads top-level key', () => {
      assert.strictEqual(readJsonDotPath('{"version":"1.2.3"}', '.version'), '1.2.3');
    });

    it('reads nested key', () => {
      assert.strictEqual(
        readJsonDotPath('{"app":{"version":"2.0"}}', '.app.version'),
        '2.0'
      );
    });

    it('returns undefined for missing path', () => {
      assert.strictEqual(readJsonDotPath('{"version":"1.0"}', '.app.version'), undefined);
    });

    it('returns undefined for invalid JSON', () => {
      assert.strictEqual(readJsonDotPath('not json', '.version'), undefined);
    });
  });

  describe('extractFirstRegexMatch', () => {
    it('returns first match', () => {
      const logger = makeLogger();
      const result = extractFirstRegexMatch(
        'feature/FEAT-123-add-login',
        '\\b[A-Z]+-\\d{3,4}\\b',
        logger
      );
      assert.strictEqual(result, 'FEAT-123');
    });

    it('returns empty string when no match', () => {
      const logger = makeLogger();
      const result = extractFirstRegexMatch('feature/login-screen', '\\b[A-Z]+-\\d{3,4}\\b', logger);
      assert.strictEqual(result, '');
    });

    it('returns empty string and warns on invalid regex', () => {
      const logger = makeLogger();
      const result = extractFirstRegexMatch('branch', '[invalid(', logger);
      assert.strictEqual(result, '');
      assert.ok(logger.warnings.some((w) => w.includes('Invalid branch regex')));
    });
  });

  describe('resolveTagTemplate', () => {
    it('resolves full template to correct tag (task spec scenario)', async () => {
      const existingTags = new Set(['mobile-v12.3.4-FEAT-123-1', 'mobile-v12.3.4-FEAT-123-2']);
      const ctx = makeCtx({
        getCurrentBranch: async () => 'feature/FEAT-123-login',
        tagExists: async (name) => existingTags.has(name),
        readFile: async () => JSON.stringify({ version: '12.3.4' }),
        realpath: async (p) => p,
      });
      const result = await resolveTagTemplate(
        'mobile-v{f:package.json:.version}-{b:\\b[A-Z]+-\\d{3,4}\\b}-{r:1}',
        ctx
      );
      assert.strictEqual(result.tag, 'mobile-v12.3.4-FEAT-123-3');
      assert.strictEqual(result.recurringValueUsed, 3);
      assert.strictEqual(result.recurringAttempts, 3);
    });

    it('produces double-dash when regex has no match (empty branch token)', async () => {
      const ctx = makeCtx({
        getCurrentBranch: async () => 'feature/login-screen',
        tagExists: async () => false,
        readFile: async () => JSON.stringify({ version: '12.3.4' }),
        realpath: async (p) => p,
      });
      const result = await resolveTagTemplate(
        'mobile-v{f:package.json:.version}-{b:\\b[A-Z]+-\\d{3,4}\\b}-{r:1}',
        ctx
      );
      assert.strictEqual(result.tag, 'mobile-v12.3.4--1');
    });

    it('resolves unsafe path ../package.json to empty and warns', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({ logger });
      const result = await resolveTagTemplate('mobile-v{f:../package.json:.version}', ctx);
      assert.strictEqual(result.tag, 'mobile-v');
      assert.ok(logger.warnings.some((w) => w.includes('Unsafe file path')));
    });

    it('resolves absolute path to empty and warns', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({ logger });
      const result = await resolveTagTemplate('mobile-v{f:/etc/passwd:.version}', ctx);
      assert.strictEqual(result.tag, 'mobile-v');
      assert.ok(logger.warnings.some((w) => w.includes('Unsafe file path')));
    });

    it('resolves to empty when realpath throws (file not found)', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({
        logger,
        realpath: async () => { throw new Error('ENOENT'); },
      });
      const result = await resolveTagTemplate('v{f:missing.json:.v}', ctx);
      assert.strictEqual(result.tag, 'v');
      assert.ok(logger.warnings.some((w) => w.includes('File not found')));
    });

    it('resolves to empty for invalid JSON', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({
        logger,
        readFile: async () => 'not json',
        realpath: async (p) => p,
      });
      const result = await resolveTagTemplate('v{f:package.json:.version}', ctx);
      assert.strictEqual(result.tag, 'v');
      assert.ok(logger.warnings.some((w) => w.includes('Could not parse JSON')));
    });

    it('resolves to empty for missing JSON path', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({
        logger,
        readFile: async () => JSON.stringify({ version: '1.0' }),
        realpath: async (p) => p,
      });
      const result = await resolveTagTemplate('v{f:package.json:.app.version}', ctx);
      assert.strictEqual(result.tag, 'v');
      assert.ok(logger.warnings.some((w) => w.includes('not found')));
    });

    it('resolves branch token to empty string on invalid regex', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({
        logger,
        getCurrentBranch: async () => 'feature/FEAT-123',
      });
      const result = await resolveTagTemplate('v1-{b:[invalid(}', ctx);
      assert.strictEqual(result.tag, 'v1-');
      assert.ok(logger.warnings.some((w) => w.includes('Invalid branch regex')));
    });

    it('resolves branch token to empty string in detached HEAD', async () => {
      const logger = makeLogger();
      const ctx = makeCtx({
        logger,
        getCurrentBranch: async () => '',
      });
      const result = await resolveTagTemplate('v1-{b:\\b[A-Z]+-\\d+\\b}', ctx);
      assert.strictEqual(result.tag, 'v1-');
    });

    it('returns template unchanged (no {r:N}) after f/b resolution', async () => {
      const ctx = makeCtx({
        getCurrentBranch: async () => 'feature/FEAT-99',
        readFile: async () => JSON.stringify({ version: '3.0.0' }),
        realpath: async (p) => p,
      });
      const result = await resolveTagTemplate(
        'v{f:package.json:.version}-{b:\\b[A-Z]+-\\d+\\b}',
        ctx
      );
      assert.strictEqual(result.tag, 'v3.0.0-FEAT-99');
      assert.strictEqual(result.recurringAttempts, 0);
      assert.strictEqual(result.recurringValueUsed, undefined);
    });

    it('{r:5} starts at 5', async () => {
      const ctx = makeCtx({ tagExists: async () => false });
      const result = await resolveTagTemplate('release-{r:5}', ctx);
      assert.strictEqual(result.tag, 'release-5');
      assert.strictEqual(result.recurringValueUsed, 5);
    });

    it('multiple {r:N} tokens in same template are all replaced with same value', async () => {
      const ctx = makeCtx({ tagExists: async () => false });
      const result = await resolveTagTemplate('{r:1}-suffix-{r:1}', ctx);
      assert.strictEqual(result.tag, '1-suffix-1');
    });

    it('throws when iteration cap is reached', async () => {
      const ctx = makeCtx({ tagExists: async () => true });
      await assert.rejects(
        () => resolveTagTemplate('v-{r:1}', ctx),
        /Could not find available tag/
      );
    });

    describe('{s:stream:script} token', () => {
      it('resolves stdout from a successful script', async () => {
        const ctx = makeCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: '2.0.0', stderr: '', exitCode: 0 }),
        });
        const result = await resolveTagTemplate('v{s:stdout:./get-version.sh}', ctx);
        assert.strictEqual(result.tag, 'v2.0.0');
      });

      it('{s:./script.sh} without stream defaults to stdout', async () => {
        const ctx = makeCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: 'default-stdout', stderr: 'other', exitCode: 0 }),
        });
        const result = await resolveTagTemplate('v{s:./get-version.sh}', ctx);
        assert.strictEqual(result.tag, 'vdefault-stdout');
      });

      it('resolves stderr when stream is "stderr"', async () => {
        const ctx = makeCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: 'ignored', stderr: 'from-stderr', exitCode: 0 }),
        });
        const result = await resolveTagTemplate('v{s:stderr:./get-version.sh}', ctx);
        assert.strictEqual(result.tag, 'vfrom-stderr');
      });

      it('throws ScriptTokenError when exit code is non-zero', async () => {
        const ctx = makeCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: '', stderr: 'oops', exitCode: 1 }),
        });
        await assert.rejects(
          () => resolveTagTemplate('v{s:stdout:./fail.sh}', ctx),
          (e: unknown) => {
            assert.ok(e instanceof ScriptTokenError);
            assert.strictEqual(e.exitCode, 1);
            assert.strictEqual(e.scriptPath, './fail.sh');
            return true;
          }
        );
      });

      it('throws ScriptTokenError for unsafe path ../script.sh', async () => {
        const ctx = makeCtx({
          runScript: async () => ({ stdout: 'x', stderr: '', exitCode: 0 }),
        });
        await assert.rejects(
          () => resolveTagTemplate('v{s:stdout:../script.sh}', ctx),
          (e: unknown) => {
            assert.ok(e instanceof ScriptTokenError);
            assert.ok(e.message.includes('Unsafe script path'));
            return true;
          }
        );
      });

      it('throws ScriptTokenError for absolute path', async () => {
        const ctx = makeCtx({
          runScript: async () => ({ stdout: 'x', stderr: '', exitCode: 0 }),
        });
        await assert.rejects(
          () => resolveTagTemplate('v{s:stdout:/usr/bin/env}', ctx),
          (e: unknown) => e instanceof ScriptTokenError
        );
      });

      it('throws ScriptTokenError when realpath fails (script not found)', async () => {
        const ctx = makeCtx({
          realpath: async () => { throw new Error('ENOENT'); },
        });
        await assert.rejects(
          () => resolveTagTemplate('v{s:stdout:./missing.sh}', ctx),
          (e: unknown) => {
            assert.ok(e instanceof ScriptTokenError);
            assert.ok(e.message.includes('Script not found'));
            return true;
          }
        );
      });

      it('stops flow: script failure prevents {r:N} from running', async () => {
        const tagExistsCalls: string[] = [];
        const ctx = makeCtx({
          realpath: async (p) => p,
          runScript: async () => ({ stdout: '', stderr: 'boom', exitCode: 2 }),
          tagExists: async (name) => { tagExistsCalls.push(name); return false; },
        });
        await assert.rejects(
          () => resolveTagTemplate('v{s:stdout:./fail.sh}-{r:1}', ctx),
          (e: unknown) => e instanceof ScriptTokenError
        );
        assert.strictEqual(tagExistsCalls.length, 0, 'tagExists should not be called after script failure');
      });

      it('script token combined with f and r tokens resolves full tag', async () => {
        const ctx = makeCtx({
          realpath: async (p) => p,
          readFile: async () => JSON.stringify({ version: '3.1.0' }),
          runScript: async () => ({ stdout: 'custom', stderr: '', exitCode: 0 }),
          tagExists: async () => false,
        });
        const result = await resolveTagTemplate(
          '{f:package.json:.version}-{s:stdout:./tag-suffix.sh}-{r:1}',
          ctx
        );
        assert.strictEqual(result.tag, '3.1.0-custom-1');
      });
    });
  });
});
