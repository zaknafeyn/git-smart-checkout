import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GitExecutor,
  parseGitVersion,
  supportsMergeTreeWriteTree,
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
