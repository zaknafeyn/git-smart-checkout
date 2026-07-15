import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { EXTENSION_NAME } from '../../const';
import {
  commandId,
  delay,
  ensureExtensionActivated,
  selectRepositoryByName,
  stubErrorMessages,
  stubInformationMessages,
  stubShowQuickPick,
  withMultiRepoWorkspace,
  withRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

/**
 * E2E coverage for "GSC: Preview branch/tag template...". These tests drive
 * the real contributed command end-to-end (real git repos, real
 * resolveBranchTemplateWithTrace/resolveTagTemplateWithTrace, a real preview
 * document opened via vscode.workspace.openTextDocument) rather than
 * exercising the resolver in isolation — see tagTemplateService.test.ts and
 * branchTemplateService.test.ts for resolver-level unit coverage.
 */

async function setTemplateConfig(overrides: {
  branchTemplate?: string;
  tagTemplate?: string;
}): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  await config.update('branchTemplate', overrides.branchTemplate ?? '', vscode.ConfigurationTarget.Global);
  await config.update('tagTemplate', overrides.tagTemplate ?? '', vscode.ConfigurationTarget.Global);
  await delay(50);
}

async function clearTemplateConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  await config.update('branchTemplate', undefined, vscode.ConfigurationTarget.Global);
  await config.update('tagTemplate', undefined, vscode.ConfigurationTarget.Global);
  await delay(50);
}

function writePackageJson(repo: TestRepo, version: string): void {
  fs.writeFileSync(
    path.join(repo.repoPath, 'package.json'),
    JSON.stringify({ name: 'fixture', version }, null, 2)
  );
}

function writeExecutableScript(repo: TestRepo, filename: string, body: string): void {
  const scriptPath = path.join(repo.repoPath, filename);
  fs.writeFileSync(scriptPath, body);
  fs.chmodSync(scriptPath, 0o755);
}

async function closeActivePreviewEditor(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } catch {
    // no-op — nothing open
  }
}

describe('Preview branch/tag template command', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  afterEach(async () => {
    await clearTemplateConfig();
  });

  it('resolves a {f:...} token against the fixture package.json and shows the token table', async () => {
    const repo = createTestRepo();
    writePackageJson(repo, '1.2.3');
    await setTemplateConfig({ branchTemplate: 'rel/{f:package.json:.version}' });

    const info = stubInformationMessages(() => undefined); // decline "Copy result"
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(100);

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'preview document should be open');
        const text = document.getText();
        assert.ok(text.includes('Result   : rel/1.2.3'), text);
        assert.ok(text.includes('{f:package.json:.version}'), text);
        assert.ok(text.includes('→ 1.2.3'), text);
        assert.deepStrictEqual(errors.messages, []);

        await closeActivePreviewEditor();
      });
    } finally {
      info.restore();
      errors.restore();
      repo.cleanup();
    }
  });

  it('prompts for script consent; accepting runs the script and shows its output', async () => {
    const repo = createTestRepo();
    writeExecutableScript(repo, 'version.sh', '#!/bin/sh\necho 9.9.9\n');
    await setTemplateConfig({ branchTemplate: 'rel-{s:./version.sh}' });

    const info = stubInformationMessages((message, items) => {
      if (message.includes('Preview will execute script')) {
        assert.ok(message.includes('./version.sh'), message);
        return items.find((i) => i === 'Run');
      }
      return undefined; // decline "Copy result"
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(150);

        assert.deepStrictEqual(errors.messages, [], `unexpected errors: ${JSON.stringify(errors.messages)}, info: ${JSON.stringify(info.messages)}`);
        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'preview document should be open');
        const text = document.getText();
        assert.ok(text.includes('Result   : rel-9.9.9'), text);
        assert.ok(text.includes('→ 9.9.9'), text);

        await closeActivePreviewEditor();
      });
    } finally {
      info.restore();
      errors.restore();
      repo.cleanup();
    }
  });

  it('prompts for script consent; declining skips the script without running it', async () => {
    const repo = createTestRepo();
    const marker = path.join(repo.repoPath, 'ran.marker');
    writeExecutableScript(repo, 'version.sh', `#!/bin/sh\ntouch "${marker}"\necho 9.9.9\n`);
    await setTemplateConfig({ branchTemplate: 'rel-{s:./version.sh}' });

    const info = stubInformationMessages((message, items) => {
      if (message.includes('Preview will execute script')) {
        return items.find((i) => i === 'Skip');
      }
      return undefined; // decline "Copy result"
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(150);

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'preview document should be open');
        const text = document.getText();
        assert.ok(text.includes('skipped (not authorized)'), text);
        assert.strictEqual(fs.existsSync(marker), false, 'declined script must not run');
        assert.deepStrictEqual(errors.messages, []);

        await closeActivePreviewEditor();
      });
    } finally {
      info.restore();
      errors.restore();
      repo.cleanup();
    }
  });

  it('opens a preview for a broken (unclosed brace) template without an error toast', async () => {
    const repo = createTestRepo();
    writePackageJson(repo, '1.0.0');
    // Missing the closing "}" — scanTokens never recognizes this as a token,
    // so it passes through literally instead of crashing the command.
    await setTemplateConfig({ branchTemplate: 'rel/{f:package.json:.version' });

    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(100);

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'preview document should still open for a malformed template');
        const text = document.getText();
        // Unrecognized token text passes through unchanged in the result.
        assert.ok(text.includes('rel/{f:package.json:.version'), text);
        assert.deepStrictEqual(errors.messages, [], 'a malformed template must not surface an error toast');

        await closeActivePreviewEditor();
      });
    } finally {
      info.restore();
      errors.restore();
      repo.cleanup();
    }
  });

  it('multi-root: resolves {f:...} against the selected repository, not workspaceFolders[0]', async () => {
    const repoA = createTestRepo();
    const repoB = createTestRepo();
    writePackageJson(repoA, '1.0.0');
    writePackageJson(repoB, '2.0.0');
    await setTemplateConfig({ branchTemplate: 'rel/{f:package.json:.version}' });

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.title === 'Choose a repository' || options?.placeHolder === 'Choose a repository') {
        return selectRepositoryByName(items, repoB);
      }
      return undefined;
    });
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withMultiRepoWorkspace([repoA, repoB], async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(150);

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'preview document should be open');
        const text = document.getText();
        assert.ok(text.includes('Result   : rel/2.0.0'), text);

        await closeActivePreviewEditor();
      });
    } finally {
      restoreQuickPick();
      info.restore();
      errors.restore();
      repoA.cleanup();
      repoB.cleanup();
    }
  });

  it('"Copy result" copies the rendered string to the clipboard', async () => {
    const repo = createTestRepo();
    writePackageJson(repo, '4.5.6');
    await setTemplateConfig({ branchTemplate: 'rel/{f:package.json:.version}' });

    await vscode.env.clipboard.writeText('');

    const info = stubInformationMessages((message, items) => {
      if (message === 'Template preview ready.') {
        return items.find((i) => i === 'Copy result');
      }
      return undefined;
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('previewTemplate'));
        await delay(150);

        assert.strictEqual(await vscode.env.clipboard.readText(), 'rel/4.5.6');
        assert.deepStrictEqual(errors.messages, []);

        await closeActivePreviewEditor();
      });
    } finally {
      info.restore();
      errors.restore();
      repo.cleanup();
    }
  });
});
