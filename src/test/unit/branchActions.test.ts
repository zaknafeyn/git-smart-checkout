import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('GitExecutor branch actions', () => {
  it('uses the expected git arguments for branch and tag operations', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-branch-actions-'));
    const log = path.join(dir, 'commands');
    fs.writeFileSync(path.join(dir, 'git'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GSC_LOG"\nprintf "main\\n"', { mode: 0o755 });
    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_LOG;
    process.env.PATH = `${dir}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_LOG = log;
    try {
      const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
      await git.deleteBranch('feature', false);
      await git.renameBranch('feature', 'renamed');
      await git.deleteTag('v1');
      assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
        'branch -d feature', 'branch -m feature renamed', 'tag -d v1',
      ]);
    } finally {
      process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.GSC_LOG; else process.env.GSC_LOG = oldLog;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
