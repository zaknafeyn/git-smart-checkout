import * as assert from 'assert';

import {
  parseStashFilesOutput,
  parseStashListOutput,
} from '../../common/git/gitExecutor';

describe('stash list parsing', () => {
  it('parses selectors, branches, timestamps, and messages containing ": "', () => {
    const output = [
      'stash@{0}',
      'abc123',
      '1781431200',
      'On feature/recovery: auto-stash-feature/recovery: extra context',
      '\nstash@{1}',
      'def456',
      '1781344800',
      'WIP on main: auto-stash-main',
      '',
    ].join('\0');

    assert.deepStrictEqual(parseStashListOutput(output), [
      {
        selector: 'stash@{0}',
        hash: 'abc123',
        message: 'auto-stash-feature/recovery: extra context',
        sourceBranch: 'feature/recovery',
        timestamp: 1781431200,
        files: [],
      },
      {
        selector: 'stash@{1}',
        hash: 'def456',
        message: 'auto-stash-main',
        sourceBranch: 'main',
        timestamp: 1781344800,
        files: [],
      },
    ]);
  });

  it('preserves spaces in NUL-delimited stash filenames', () => {
    assert.deepStrictEqual(
      parseStashFilesOutput('src/one.ts\0docs/file with spaces.md\0'),
      ['src/one.ts', 'docs/file with spaces.md']
    );
  });
});
