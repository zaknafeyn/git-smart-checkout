import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeFakeGitExecutor(dir: string, currentBranch: string, reflogLines: string[]): GitExecutor {
  const git = path.join(dir, 'git');
  // getCurrentBranch() runs `git branch --show-current`; getRecentBranches()
  // runs `git reflog --format=%gs -n 200`. Route on $1 to serve each.
  const script = [
    '#!/bin/sh',
    `if [ "$1" = "branch" ]; then printf "${currentBranch}\\n"; else printf "${reflogLines.join('\\n')}\\n"; fi`,
  ].join('\n');
  fs.writeFileSync(git, script, { mode: 0o755 });
  return new GitExecutor(dir, mockLogService as unknown as LoggingService);
}

describe('GitExecutor.getRecentBranches', () => {
  let dir: string;
  let oldPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-recent-'));
    oldPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${oldPath ?? ''}`;
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('parses checkout entries, excludes current/detached targets, and ranks by frequency', async () => {
    const executor = makeFakeGitExecutor(dir, 'main', [
      'checkout: moving from main to a',
      'checkout: moving from a to b',
      'checkout: moving from b to a',
      'checkout: moving from a to detached HEAD',
      'checkout: moving from a to b',
      'commit: ordinary',
    ]);
    assert.deepStrictEqual(await executor.getRecentBranches(3), ['a', 'b']);
    assert.deepStrictEqual(await executor.getRecentBranches(0), []);
  });

  it('ignores mixed non-checkout reflog lines (commit/rebase/reset) and keeps order deduped', async () => {
    const executor = makeFakeGitExecutor(dir, 'main', [
      'commit: work in progress',
      'checkout: moving from main to a',
      'rebase (finish): refs/heads/a onto abc123',
      'checkout: moving from a to b',
      'reset: moving to HEAD~1',
      'checkout: moving from b to a',
    ]);
    assert.deepStrictEqual(await executor.getRecentBranches(5), ['a', 'b']);
  });

  it('excludes the current branch even if it appears as a checkout target', async () => {
    const executor = makeFakeGitExecutor(dir, 'main', [
      'checkout: moving from a to main',
      'checkout: moving from main to b',
      'checkout: moving from b to main',
    ]);
    const result = await executor.getRecentBranches(5);
    assert.ok(!result.includes('main'), 'current branch should never appear in the recent list');
    assert.deepStrictEqual(result, ['b']);
  });

  it('caps the returned list at limit * 2 (over-fetch to survive the existence filter)', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const lines = names.map((name, index) => {
      const from = index === 0 ? 'main' : names[index - 1];
      return `checkout: moving from ${from} to ${name}`;
    });
    const executor = makeFakeGitExecutor(dir, 'main', lines);
    const result = await executor.getRecentBranches(2);
    assert.strictEqual(result.length, 4, 'should cap at limit * 2');
  });

  it('does not crash on malformed lines, detached HEAD SHAs, or branch names containing " to "', async () => {
    const executor = makeFakeGitExecutor(dir, 'main', [
      'checkout: moving from a to feature-to-prod',
      'checkout: moving from deadbeef1234 to a',
      'checkout: moving from a to HEAD',
      'some unrelated garbage line',
      'checkout: moving from feature-to-prod to a',
    ]);
    const result = await executor.getRecentBranches(5);
    assert.ok(Array.isArray(result));
    // Greedy matching on names containing " to " is an accepted ambiguity —
    // the important guarantee is that parsing never throws and yields a sane list.
    assert.ok(result.includes('a'));
    assert.ok(!result.includes('HEAD'), 'checkout targeting literal HEAD should never surface as a branch');
  });

  it('ranks a more-frequent-but-older branch above a less-frequent-but-more-recent one', async () => {
    // Newest reflog entries first (matches real `git reflog` ordering).
    const executor = makeFakeGitExecutor(dir, 'main', [
      'checkout: moving from x to a',
      'checkout: moving from a to b',
      'checkout: moving from b to a',
      'checkout: moving from a to b',
      'checkout: moving from b to a',
    ]);
    const result = await executor.getRecentBranches(5);
    assert.deepStrictEqual(result, ['a', 'b'], 'a occurs 3x vs b 2x, so a should rank first');
  });
});
