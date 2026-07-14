import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
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
