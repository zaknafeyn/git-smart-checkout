import * as assert from 'assert';

import {
  parseStashFilesOutput,
  parseStashListOutput,
  parseStashNameStatusOutput,
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

describe('stash name-status parsing', () => {
  // Under `-z` the status and path are separated by NUL, not a tab.
  it('pairs each status with its following path', () => {
    assert.deepStrictEqual(
      parseStashNameStatusOutput('D\0todelete.txt\0M\0tracked.txt\0A\0untracked.txt\0'),
      [
        { status: 'D', path: 'todelete.txt' },
        { status: 'M', path: 'tracked.txt' },
        { status: 'A', path: 'untracked.txt' },
      ]
    );
  });

  it('reports the destination path for renames and copies', () => {
    assert.deepStrictEqual(
      parseStashNameStatusOutput('R100\0old.txt\0new.txt\0C75\0src.txt\0copy.txt\0M\0after.txt\0'),
      [
        { status: 'R100', path: 'new.txt' },
        { status: 'C75', path: 'copy.txt' },
        { status: 'M', path: 'after.txt' },
      ]
    );
  });

  it('preserves spaces in paths and handles empty output', () => {
    assert.deepStrictEqual(
      parseStashNameStatusOutput('M\0docs/file with spaces.md\0'),
      [{ status: 'M', path: 'docs/file with spaces.md' }]
    );
    assert.deepStrictEqual(parseStashNameStatusOutput(''), []);
  });
});
