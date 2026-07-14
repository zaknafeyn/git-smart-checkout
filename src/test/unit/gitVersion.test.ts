import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GitExecutor,
  parseGitVersion,
  supportsMergeTreeWriteTree,
  supportsStashShowIncludeUntracked,
} from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';

describe('Git merge-tree compatibility', () => {
  it('parses standard and Apple Git version strings', () => {
    assert.deepStrictEqual(parseGitVersion('git version 2.38.0'), [2, 38, 0]);
    assert.deepStrictEqual(
      parseGitVersion('git version 2.39.5 (Apple Git-154)'),
      [2, 39, 5]
    );
    assert.strictEqual(parseGitVersion('unknown'), undefined);
  });

  it('requires Git 2.38 or newer', () => {
    assert.strictEqual(supportsMergeTreeWriteTree('git version 2.37.9'), false);
    assert.strictEqual(supportsMergeTreeWriteTree('git version 2.38.0'), true);
    assert.strictEqual(supportsMergeTreeWriteTree('git version 3.0.0'), true);
  });

  it('checks an unsupported Git version once and skips merge-tree', async () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-'));
    const gitLog = path.join(fakeBin, 'commands.log');
    const gitPath = path.join(fakeBin, 'git');
    fs.writeFileSync(
      gitPath,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
        'if [ "$1" = "--version" ]; then',
        '  echo "git version 2.37.9"',
        '  exit 0',
        'fi',
        'exit 99',
        '',
      ].join('\n'),
      { mode: 0o755 }
    );

    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    const warnings: string[] = [];
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    const logger = {
      info: () => {},
      warn: (message: string) => warnings.push(message),
      error: () => {},
      debug: () => {},
      dispose: () => {},
    } as unknown as LoggingService;

    try {
      const git = new GitExecutor(fakeBin, logger);
      assert.deepStrictEqual(await git.getStashConflictPreview('main'), []);
      assert.deepStrictEqual(await git.getStashConflictPreview('feature'), []);

      assert.deepStrictEqual(
        fs.readFileSync(gitLog, 'utf8').trim().split('\n'),
        ['--version']
      );
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings.every((message) => message.includes('Git 2.38')));
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) {
        delete process.env.GSC_GIT_TEST_LOG;
      } else {
        process.env.GSC_GIT_TEST_LOG = oldLog;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});

describe('Git stash --include-untracked compatibility', () => {
  it('requires Git 2.32 or newer', () => {
    assert.strictEqual(supportsStashShowIncludeUntracked('git version 2.31.9'), false);
    assert.strictEqual(supportsStashShowIncludeUntracked('git version 2.32.0'), true);
    assert.strictEqual(supportsStashShowIncludeUntracked('git version 3.0.0'), true);
  });

  it('drops --include-untracked and appends a note on older Git', async () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-'));
    const gitLog = path.join(fakeBin, 'commands.log');
    const gitPath = path.join(fakeBin, 'git');
    fs.writeFileSync(
      gitPath,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
        'if [ "$1" = "--version" ]; then',
        '  echo "git version 2.31.9"',
        '  exit 0',
        'fi',
        'if [ "$1" = "stash" ] && [ "$2" = "show" ]; then',
        '  echo "diff content"',
        '  exit 0',
        'fi',
        'exit 99',
        '',
      ].join('\n'),
      { mode: 0o755 }
    );

    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      dispose: () => {},
    } as unknown as LoggingService;

    try {
      const git = new GitExecutor(fakeBin, logger);
      const patch = await git.getStashPatch('stash@{0}');

      assert.ok(patch.includes('diff content'));
      assert.match(patch, /untracked files not shown/i);

      const loggedCommands = fs.readFileSync(gitLog, 'utf8').trim().split('\n');
      const stashCommand = loggedCommands.find((line) => line.startsWith('stash show'));
      assert.ok(stashCommand, 'expected a stash show command to be logged');
      assert.ok(!stashCommand!.includes('--include-untracked'));
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) {
        delete process.env.GSC_GIT_TEST_LOG;
      } else {
        process.env.GSC_GIT_TEST_LOG = oldLog;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('keeps --include-untracked on newer Git without appending a note', async () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-'));
    const gitLog = path.join(fakeBin, 'commands.log');
    const gitPath = path.join(fakeBin, 'git');
    fs.writeFileSync(
      gitPath,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
        'if [ "$1" = "--version" ]; then',
        '  echo "git version 2.40.0"',
        '  exit 0',
        'fi',
        'if [ "$1" = "stash" ] && [ "$2" = "show" ]; then',
        '  echo "diff content"',
        '  exit 0',
        'fi',
        'exit 99',
        '',
      ].join('\n'),
      { mode: 0o755 }
    );

    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      dispose: () => {},
    } as unknown as LoggingService;

    try {
      const git = new GitExecutor(fakeBin, logger);
      const patch = await git.getStashPatch('stash@{0}');

      assert.strictEqual(patch.trim(), 'diff content');

      const loggedCommands = fs.readFileSync(gitLog, 'utf8').trim().split('\n');
      const stashCommand = loggedCommands.find((line) => line.startsWith('stash show'));
      assert.ok(stashCommand, 'expected a stash show command to be logged');
      assert.ok(stashCommand!.includes('--include-untracked'));
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) {
        delete process.env.GSC_GIT_TEST_LOG;
      } else {
        process.env.GSC_GIT_TEST_LOG = oldLog;
      }
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
