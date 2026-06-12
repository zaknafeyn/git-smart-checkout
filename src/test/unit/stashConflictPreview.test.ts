import * as assert from 'assert';
import { ExecException } from 'child_process';

import { handleStashConflictPreviewError } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';

type PreviewError = ExecException & {
  stdout?: string;
  stderr?: string;
};

function makeError(code: number, stdout: string, stderr = ''): PreviewError {
  return Object.assign(new Error('git merge-tree failed'), { code, stdout, stderr });
}

describe('handleStashConflictPreviewError', () => {
  it('parses conflict paths only for exit code 1', () => {
    const warnings: string[] = [];
    const logService = {
      warn: (message: string) => warnings.push(message),
    } as Pick<LoggingService, 'warn'>;

    const conflicts = handleStashConflictPreviewError(
      makeError(1, 'tree-oid\nsrc/one.ts\nsrc/two.ts\n'),
      logService
    );

    assert.deepStrictEqual(conflicts, ['src/one.ts', 'src/two.ts']);
    assert.deepStrictEqual(warnings, []);
  });

  it('ignores stdout and warns for fatal exit codes', () => {
    const warnings: string[] = [];
    const logService = {
      warn: (message: string) => warnings.push(message),
    } as Pick<LoggingService, 'warn'>;

    const conflicts = handleStashConflictPreviewError(
      makeError(128, 'fatal-output\nnot-a-conflict-path.ts\n', 'fatal: unsupported option'),
      logService
    );

    assert.deepStrictEqual(conflicts, []);
    assert.deepStrictEqual(warnings, [
      'Stash conflict preview unavailable: git merge-tree exited with code 128.',
    ]);
  });
});
