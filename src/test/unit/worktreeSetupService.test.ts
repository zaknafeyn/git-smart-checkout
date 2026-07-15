import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { window as vscodeWindow } from 'vscode';

import { ConfigurationManager } from '../../configuration/configurationManager';
import { ExtensionConfig } from '../../configuration/extensionConfig';
import {
  WORKTREE_SETUP_CONSENT_KEY,
  WorktreeSetupMemento,
  WorktreeSetupService,
} from '../../services/worktreeSetupService';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeConfigManager(worktreeSetup: Partial<ExtensionConfig['worktreeSetup']>): ConfigurationManager {
  const config = {
    worktreeSetup: {
      copyFiles: [],
      command: '',
      applyToPrCloneWorktrees: false,
      ...worktreeSetup,
    },
  } as unknown as ExtensionConfig;

  return {
    get: () => config,
  } as unknown as ConfigurationManager;
}

function makeMemento(): WorktreeSetupMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: (<T>(key: string, defaultValue?: T) =>
      store.has(key) ? (store.get(key) as T) : defaultValue) as WorktreeSetupMemento['get'],
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

function initSourceRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-worktree-setup-src-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@test.com', { cwd: dir });
  execSync('git config user.name Test', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'tracked\n');
  execSync('git add README.md', { cwd: dir });
  execSync('git commit -q -m init', { cwd: dir });
  return dir;
}

describe('WorktreeSetupService', () => {
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    sourceDir = initSourceRepo();
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-worktree-setup-target-'));
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  describe('copyFiles', () => {
    it('copies untracked and ignored files matching globs, preserving relative paths', async () => {
      fs.writeFileSync(path.join(sourceDir, '.env'), 'SECRET=1\n');
      fs.mkdirSync(path.join(sourceDir, 'config'));
      fs.writeFileSync(path.join(sourceDir, 'config', 'app.local'), 'local-config\n');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'dist/\n');
      fs.mkdirSync(path.join(sourceDir, 'dist'));
      fs.writeFileSync(path.join(sourceDir, 'dist', 'bundle.js'), 'ignored\n');

      const config = makeConfigManager({ copyFiles: ['.env*', 'config/*.local'] });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.copiedFiles, 2);
      assert.strictEqual(fs.readFileSync(path.join(targetDir, '.env'), 'utf-8'), 'SECRET=1\n');
      assert.strictEqual(
        fs.readFileSync(path.join(targetDir, 'config', 'app.local'), 'utf-8'),
        'local-config\n'
      );
      // Not matched by any glob -> not copied, even though ignored.
      assert.strictEqual(fs.existsSync(path.join(targetDir, 'dist', 'bundle.js')), false);
    });

    it('never copies tracked files', async () => {
      const config = makeConfigManager({ copyFiles: ['README.md', '*.md'] });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.copiedFiles, 0);
      assert.strictEqual(fs.existsSync(path.join(targetDir, 'README.md')), false);
    });

    it('does not overwrite a file that already exists at the destination', async () => {
      fs.writeFileSync(path.join(sourceDir, '.env'), 'from-source\n');
      fs.writeFileSync(path.join(targetDir, '.env'), 'pre-existing\n');

      const config = makeConfigManager({ copyFiles: ['.env*'] });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.copiedFiles, 0);
      assert.strictEqual(fs.readFileSync(path.join(targetDir, '.env'), 'utf-8'), 'pre-existing\n');
    });

    it('skips symlinks instead of following them', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }

      const outsideFile = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-outside-'));
      fs.writeFileSync(path.join(outsideFile, 'secret.txt'), 'outside\n');
      fs.symlinkSync(path.join(outsideFile, 'secret.txt'), path.join(sourceDir, '.env.link'));

      const warnings: string[] = [];
      const logger = { ...mockLogService, info: (message: string) => warnings.push(message) };

      const config = makeConfigManager({ copyFiles: ['.env*'] });
      const service = new WorktreeSetupService(config, logger as unknown as typeof mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.copiedFiles, 0);
      assert.strictEqual(fs.existsSync(path.join(targetDir, '.env.link')), false);
      assert.ok(warnings.some((message) => message.includes('symlink')));

      fs.rmSync(outsideFile, { recursive: true, force: true });
    });

    it('does nothing when copyFiles is empty', async () => {
      fs.writeFileSync(path.join(sourceDir, '.env'), 'x\n');
      const config = makeConfigManager({ copyFiles: [] });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.copiedFiles, 0);
    });
  });

  describe('command consent state machine', () => {
    let originalShowWarningMessage: typeof vscodeWindow.showWarningMessage;

    beforeEach(() => {
      originalShowWarningMessage = vscodeWindow.showWarningMessage;
    });

    afterEach(() => {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    });

    function stubWarning(response: string | undefined): { calls: number } {
      const stats = { calls: 0 };
      (vscodeWindow as any).showWarningMessage = async (..._args: unknown[]) => {
        stats.calls += 1;
        return response;
      };
      return stats;
    }

    it('prompts on first run and does not persist when dismissed', async () => {
      const stats = stubWarning(undefined);
      const memento = makeMemento();
      const config = makeConfigManager({ command: 'node -e "1"' });
      const service = new WorktreeSetupService(config, mockLogService, memento);

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(stats.calls, 1);
      assert.strictEqual(result.commandRan, false);
      assert.strictEqual(memento.store.has(WORKTREE_SETUP_CONSENT_KEY), false);
    });

    it('"Always" persists consent so subsequent runs do not prompt', async () => {
      const stats = stubWarning('Always');
      const memento = makeMemento();
      const config = makeConfigManager({ command: 'node -e "1"' });
      const service = new WorktreeSetupService(config, mockLogService, memento);

      const first = await service.runSetup(sourceDir, targetDir);
      assert.strictEqual(stats.calls, 1);
      assert.strictEqual(first.commandRan, true);

      // Second run: no prompt, command still runs.
      stubWarning('Never'); // would fail the test if called
      const secondStats = { calls: 0 };
      (vscodeWindow as any).showWarningMessage = async () => {
        secondStats.calls += 1;
        return 'Never';
      };
      const second = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(secondStats.calls, 0);
      assert.strictEqual(second.commandRan, true);
    });

    it('"Never" persists consent so the command never runs and never prompts again', async () => {
      const stats = stubWarning('Never');
      const memento = makeMemento();
      const config = makeConfigManager({ command: 'node -e "1"' });
      const service = new WorktreeSetupService(config, mockLogService, memento);

      const first = await service.runSetup(sourceDir, targetDir);
      assert.strictEqual(stats.calls, 1);
      assert.strictEqual(first.commandRan, false);

      const secondStats = { calls: 0 };
      (vscodeWindow as any).showWarningMessage = async () => {
        secondStats.calls += 1;
        return undefined;
      };
      const second = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(secondStats.calls, 0);
      assert.strictEqual(second.commandRan, false);
    });

    it('re-prompts when the configured command string changes', async () => {
      const memento = makeMemento();
      await memento.update(WORKTREE_SETUP_CONSENT_KEY, { command: 'npm ci', choice: 'always' });

      const stats = stubWarning('Never');
      const config = makeConfigManager({ command: 'yarn install' });
      const service = new WorktreeSetupService(config, mockLogService, memento);

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(stats.calls, 1);
      assert.strictEqual(result.commandRan, false);
    });

    it('skips prompting entirely when no command is configured', async () => {
      const stats = stubWarning('Always');
      const config = makeConfigManager({ command: '' });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(stats.calls, 0);
      assert.strictEqual(result.commandRan, false);
    });
  });

  describe('command execution failure handling', () => {
    let originalShowWarningMessage: typeof vscodeWindow.showWarningMessage;

    beforeEach(() => {
      originalShowWarningMessage = vscodeWindow.showWarningMessage;
      (vscodeWindow as any).showWarningMessage = async () => 'Always';
    });

    afterEach(() => {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
    });

    it('a non-zero exit code is warned about but resolves without throwing, worktree untouched', async () => {
      const warnings: string[] = [];
      const logger = { ...mockLogService, warn: (message: string) => warnings.push(message) };

      const config = makeConfigManager({ command: 'node -e "process.exit(1)"' });
      const service = new WorktreeSetupService(config, logger as unknown as typeof mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.commandRan, true);
      assert.ok(warnings.some((message) => message.includes('exited with code 1')));
      // The target directory itself is never removed/modified by a failing command.
      assert.strictEqual(fs.existsSync(targetDir), true);
    });

    it('a successful command produces a marker file in the target worktree', async () => {
      const markerPath = path.join(targetDir, 'setup-ran.txt');
      const config = makeConfigManager({
        command: `node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"`,
      });
      const service = new WorktreeSetupService(config, mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.commandRan, true);
      assert.strictEqual(fs.readFileSync(markerPath, 'utf-8'), 'ok');
    });
  });

  describe('cancellation', () => {
    let originalShowWarningMessage: typeof vscodeWindow.showWarningMessage;
    let originalWithProgress: typeof vscodeWindow.withProgress;

    beforeEach(() => {
      originalShowWarningMessage = vscodeWindow.showWarningMessage;
      originalWithProgress = vscodeWindow.withProgress;
      (vscodeWindow as any).showWarningMessage = async () => 'Always';
    });

    afterEach(() => {
      (vscodeWindow as any).showWarningMessage = originalShowWarningMessage;
      (vscodeWindow as any).withProgress = originalWithProgress;
    });

    it('kills the child process and warns when the progress token is cancelled', async () => {
      // Simulate the user clicking "Cancel" on the progress notification: fire
      // onCancellationRequested shortly after the task starts.
      let listeners: Array<() => void> = [];
      (vscodeWindow as any).withProgress = (
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<void>
      ) => {
        const token = {
          isCancellationRequested: false,
          onCancellationRequested: (listener: () => void) => {
            listeners.push(listener);
            return { dispose: () => {} };
          },
        };
        const result = task({ report: () => {} }, token);
        // Fire cancellation right after the child is spawned.
        setTimeout(() => listeners.forEach((l) => l()), 20);
        return result;
      };

      const warnings: string[] = [];
      const logger = { ...mockLogService, warn: (message: string) => warnings.push(message) };

      // A long-running command that would otherwise keep going well past the test timeout.
      const config = makeConfigManager({ command: 'node -e "setTimeout(() => {}, 5000)"' });
      const service = new WorktreeSetupService(config, logger as unknown as typeof mockLogService, makeMemento());

      const result = await service.runSetup(sourceDir, targetDir);

      assert.strictEqual(result.commandRan, true);
      assert.ok(warnings.some((message) => message.includes('cancelled')));
    }).timeout(10000);
  });
});
