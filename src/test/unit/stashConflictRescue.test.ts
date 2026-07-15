import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { offerConflictRescue } from '../../services/stashConflictRescue';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('GitExecutor stash conflict recovery', () => {
  it('issues reset --merge for the undo action', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-stash-rescue-'));
    const log = path.join(dir, 'commands');
    fs.writeFileSync(path.join(dir, 'git'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GSC_LOG"', { mode: 0o755 });
    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_LOG;
    process.env.PATH = `${dir}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_LOG = log;
    try {
      await new GitExecutor(dir, mockLogService as unknown as LoggingService).resetMerge();
      assert.strictEqual(fs.readFileSync(log, 'utf8').trim(), 'reset --merge');
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.GSC_LOG; else process.env.GSC_LOG = oldLog;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('offerConflictRescue', () => {
  function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
    return {
      repositoryPath: '/repo',
      isMergeInProgress: async () => false,
      isCherryPickInProgress: async () => false,
      resetMerge: async () => {},
      ...overrides,
    } as unknown as GitExecutor;
  }

  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;

  beforeEach(() => {
    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalExecuteCommand = vscode.commands.executeCommand;
  });

  afterEach(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  });

  it('wording distinguishes pop (stash preserved because pop conflicted) from apply', async () => {
    const messages: string[] = [];
    (vscode.window as any).showWarningMessage = async (message: string) => {
      messages.push(message);
      return undefined;
    };
    (vscode.commands as any).executeCommand = async () => undefined;

    await offerConflictRescue(makeGitStub(), ['a.txt', 'b.txt'], 'pop');
    await offerConflictRescue(makeGitStub(), ['a.txt', 'b.txt'], 'apply');

    assert.match(messages[0], /Stash restored with conflicts: 2 file\(s\) need resolution/);
    assert.match(messages[0], /preserved because pop conflicted/);
    assert.match(messages[1], /preserved because apply never removes it/);
  });

  it('"Resolve conflicts" focuses SCM view and opens the first file with the merge editor', async () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    (vscode.window as any).showWarningMessage = async () => 'Resolve conflicts';
    (vscode.commands as any).executeCommand = async (command: string, ...args: unknown[]) => {
      calls.push({ command, args });
      if (command === 'git.openMergeEditor') {
        return undefined;
      }
      return undefined;
    };

    await offerConflictRescue(makeGitStub(), ['a.txt', 'b.txt'], 'pop');

    assert.strictEqual(calls[0].command, 'workbench.view.scm');
    assert.strictEqual(calls[1].command, 'git.openMergeEditor');
    const uri = calls[1].args[0] as vscode.Uri;
    assert.strictEqual(uri.fsPath, path.resolve('/repo', 'a.txt'));
    // Only the first conflicted file is opened for resolution.
    assert.strictEqual(calls.length, 2);
  });

  it('"Resolve conflicts" falls back to vscode.open when merge editor commands are unavailable', async () => {
    const calls: string[] = [];
    (vscode.window as any).showWarningMessage = async () => 'Resolve conflicts';
    (vscode.commands as any).executeCommand = async (command: string) => {
      calls.push(command);
      if (command === 'git.openMergeEditor' || command === 'vscode.openWith') {
        throw new Error('command not found');
      }
      return undefined;
    };

    await offerConflictRescue(makeGitStub(), ['a.txt'], 'pop');

    assert.deepStrictEqual(calls, ['workbench.view.scm', 'git.openMergeEditor', 'vscode.openWith', 'vscode.open']);
  });

  it('"Open files" opens every conflicted file as a regular editor', async () => {
    const openedUris: string[] = [];
    (vscode.window as any).showWarningMessage = async () => 'Open files';
    (vscode.commands as any).executeCommand = async (command: string, uri: vscode.Uri) => {
      assert.strictEqual(command, 'vscode.open');
      openedUris.push(uri.fsPath);
    };

    await offerConflictRescue(makeGitStub(), ['a.txt', 'b.txt', 'c.txt'], 'apply');

    assert.strictEqual(openedUris.length, 3);
    assert.deepStrictEqual(
      openedUris.sort(),
      ['a.txt', 'b.txt', 'c.txt'].map((f) => path.resolve('/repo', f)).sort()
    );
  });

  it('"Undo (keep stash)" runs resetMerge and informs the user the stash is preserved', async () => {
    let resetMergeCalled = false;
    const infoMessages: string[] = [];
    (vscode.window as any).showWarningMessage = async () => 'Undo (keep stash)';
    (vscode.window as any).showInformationMessage = async (message: string) => {
      infoMessages.push(message);
      return undefined;
    };

    const git = makeGitStub({ resetMerge: async () => { resetMergeCalled = true; } });
    await offerConflictRescue(git, ['a.txt'], 'pop');

    assert.strictEqual(resetMergeCalled, true);
    assert.match(infoMessages[0], /stash is preserved/i);
    assert.match(infoMessages[0], /Manage auto-stashes/);
  });

  it('does not offer Undo when a merge is already in progress (MERGE_HEAD present)', async () => {
    let actionsOffered: (string | undefined)[] = [];
    (vscode.window as any).showWarningMessage = async (_message: string, ...actions: string[]) => {
      actionsOffered = actions;
      return undefined;
    };

    const git = makeGitStub({ isMergeInProgress: async () => true });
    await offerConflictRescue(git, ['a.txt'], 'pop');

    assert.deepStrictEqual(actionsOffered, ['Resolve conflicts', 'Open files']);
  });

  it('does not offer Undo when a cherry-pick is in progress (CHERRY_PICK_HEAD present)', async () => {
    let actionsOffered: (string | undefined)[] = [];
    (vscode.window as any).showWarningMessage = async (_message: string, ...actions: string[]) => {
      actionsOffered = actions;
      return undefined;
    };

    const git = makeGitStub({ isCherryPickInProgress: async () => true });
    await offerConflictRescue(git, ['a.txt'], 'pop');

    assert.deepStrictEqual(actionsOffered, ['Resolve conflicts', 'Open files']);
  });

  it('offers Undo when no other merge-like operation is in progress', async () => {
    let actionsOffered: (string | undefined)[] = [];
    (vscode.window as any).showWarningMessage = async (_message: string, ...actions: string[]) => {
      actionsOffered = actions;
      return undefined;
    };

    await offerConflictRescue(makeGitStub(), ['a.txt'], 'pop');

    assert.deepStrictEqual(actionsOffered, ['Resolve conflicts', 'Open files', 'Undo (keep stash)']);
  });
});
