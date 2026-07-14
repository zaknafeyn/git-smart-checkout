import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('GitExecutor.getRecentBranches', () => {
  it('parses checkout entries, excludes current/detached targets, and ranks by frequency', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-recent-'));
    const git = path.join(dir, 'git');
    fs.writeFileSync(git, [
      '#!/bin/sh',
      'if [ "$1" = "rev-parse" ]; then printf "main\\n"; else printf "checkout: moving from main to a\\ncheckout: moving from a to b\\ncheckout: moving from b to a\\ncheckout: moving from a to detached HEAD\\ncheckout: moving from a to b\\ncommit: ordinary\\n"; fi',
    ].join('\n'), { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${oldPath ?? ''}`;
    try {
      const executor = new GitExecutor(dir, mockLogService as unknown as LoggingService);
      assert.deepStrictEqual(await executor.getRecentBranches(3), ['a', 'b']);
      assert.deepStrictEqual(await executor.getRecentBranches(0), []);
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
