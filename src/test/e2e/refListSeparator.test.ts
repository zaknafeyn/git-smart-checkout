import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

import { GitExecutor } from '../../common/git/gitExecutor';

import { mockLogService } from './helpers/mockLogService';

/**
 * Regression tests for ref-list parsing when a commit subject contains the
 * character that used to be the field separator (`|`).
 *
 * Previously `for-each-ref` joined fields with `|` and the parser did
 * `line.split('|')`, so a subject like `feat: add a | b parser` shifted every
 * field after `%(subject)` — corrupting `upstream:track` (NaN ahead/behind)
 * and the author name. The separator is now the ASCII Unit Separator (\x1f),
 * which cannot occur in a commit subject.
 */
describe('GitExecutor.getAllRefListExtended — separator robustness', () => {
  const PIPE_SUBJECT = 'feat: add a | b parser';
  const AUTHOR_NAME = 'Pipe Author';

  let repoPath: string;
  let remoteRepoPath: string;
  let git: GitExecutor;

  function exec(cmd: string) {
    execSync(cmd, { cwd: repoPath, stdio: 'pipe' });
  }

  before(() => {
    remoteRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-sep-remote-'));
    execSync('git init --bare', { cwd: remoteRepoPath, stdio: 'pipe' });

    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-sep-test-'));
    exec('git init -b main');
    exec('git config user.email "pipe@test.local"');
    exec(`git config user.name "${AUTHOR_NAME}"`);

    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    // Track a real remote so %(upstream:track) is populated.
    exec(`git remote add origin "${remoteRepoPath}"`);
    exec('git push -u origin main');

    // A commit whose subject contains the legacy separator character. main is
    // now 1 commit ahead of its upstream origin/main.
    exec(`git commit --allow-empty -m "${PIPE_SUBJECT}"`);

    git = new GitExecutor(repoPath, mockLogService);
  });

  after(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(remoteRepoPath, { recursive: true, force: true });
  });

  it('preserves the full subject (pipe is not treated as a field boundary)', async () => {
    const refs = await git.getAllRefListExtended();
    const mainRef = refs.find((ref) => !ref.isTag && !ref.remote && ref.name === 'main');

    assert.ok(mainRef, 'main branch should be present in the ref list');
    assert.strictEqual(mainRef!.comment, PIPE_SUBJECT, 'subject with a pipe must be kept intact');
  });

  it('parses author name correctly despite a pipe in the subject', async () => {
    const refs = await git.getAllRefListExtended();
    const mainRef = refs.find((ref) => !ref.isTag && !ref.remote && ref.name === 'main');

    assert.ok(mainRef, 'main branch should be present in the ref list');
    assert.strictEqual(
      mainRef!.authorName,
      AUTHOR_NAME,
      'author name must not be shifted by a pipe in the subject'
    );
  });

  it('parses ahead/behind tracking info without NaN despite a pipe in the subject', async () => {
    const refs = await git.getAllRefListExtended();
    const mainRef = refs.find((ref) => !ref.isTag && !ref.remote && ref.name === 'main');

    assert.ok(mainRef, 'main branch should be present in the ref list');
    // local main is 1 commit ahead of origin/main (the empty pipe commit), 0 behind.
    assert.deepStrictEqual(
      mainRef!.parsedUpstreamTrack,
      [1, 0],
      'ahead/behind must be parsed correctly, not shifted into NaN'
    );
  });
});
