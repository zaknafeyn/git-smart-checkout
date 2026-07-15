import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import {
  clearRememberedRemotes,
  rememberRemote,
  resolveGitHubRemote,
  resolveRemote,
} from '../../common/git/remoteResolver';
import { mockLogService } from '../e2e/helpers/mockLogService';

interface FakeRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

function makeFakeGit(opts: {
  repositoryPath?: string;
  remotes: FakeRemote[];
  upstreamByBranch?: Record<string, string | undefined>;
}): GitExecutor {
  const fake = {
    repositoryPath: opts.repositoryPath ?? '/repo',
    listRemotes: async () => opts.remotes,
    getUpstreamRemote: async (branch: string) => opts.upstreamByBranch?.[branch],
  };
  return fake as unknown as GitExecutor;
}

const ORIGIN: FakeRemote = { name: 'origin', fetchUrl: 'https://github.com/me/fork.git', pushUrl: 'https://github.com/me/fork.git' };
const UPSTREAM: FakeRemote = { name: 'upstream', fetchUrl: 'https://github.com/acme/canonical.git', pushUrl: 'https://github.com/acme/canonical.git' };

describe('remoteResolver.resolveRemote', () => {
  beforeEach(() => clearRememberedRemotes());

  it('prefers the branch upstream remote (rung 1)', async () => {
    const git = makeFakeGit({
      remotes: [ORIGIN, UPSTREAM],
      upstreamByBranch: { feature: 'upstream' },
    });

    const result = await resolveRemote(git, { branch: 'feature', defaultRemote: 'origin', purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'upstream' });
  });

  it('falls back to the defaultRemote setting when no upstream is configured (rung 2)', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveRemote(git, { defaultRemote: 'upstream', purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'upstream' });
  });

  it('skips the defaultRemote setting when it names a nonexistent remote', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN] });
    const result = await resolveRemote(git, { defaultRemote: 'nonexistent', purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });

  it('picks the single remote when the repo has exactly one (rung 3)', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN] });
    const result = await resolveRemote(git, { purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });

  it('returns needsPick when multiple remotes exist and nothing else resolves', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveRemote(git, { purpose: 'fetch' });
    assert.deepStrictEqual(result, { needsPick: [ORIGIN, UPSTREAM] });
  });

  it('uses a remembered pick for the same repo instead of asking again', async () => {
    const git = makeFakeGit({ repositoryPath: '/repo-a', remotes: [ORIGIN, UPSTREAM] });
    rememberRemote('/repo-a', 'upstream');

    const result = await resolveRemote(git, { purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'upstream' });
  });

  it('does not leak remembered picks to a different repo', async () => {
    rememberRemote('/repo-a', 'upstream');
    const gitB = makeFakeGit({ repositoryPath: '/repo-b', remotes: [ORIGIN, UPSTREAM] });

    const result = await resolveRemote(gitB, { purpose: 'fetch' });
    assert.deepStrictEqual(result, { needsPick: [ORIGIN, UPSTREAM] });
  });

  it('regression: single-remote repo named origin resolves to origin unchanged', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN] });
    const result = await resolveRemote(git, { branch: 'main', defaultRemote: '', purpose: 'push' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });
});

describe('remoteResolver.resolveGitHubRemote', () => {
  beforeEach(() => clearRememberedRemotes());

  it('picks upstream when the PR base repo matches the canonical remote', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch', githubRepo: 'acme/canonical' });
    assert.deepStrictEqual(result, { remote: 'upstream' });
  });

  it('picks origin when the PR base repo matches the fork remote', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch', githubRepo: 'me/fork' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });

  it('is case-insensitive when matching owner/repo', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch', githubRepo: 'ACME/Canonical' });
    assert.deepStrictEqual(result, { remote: 'upstream' });
  });

  it('falls back to generic resolution when no remote matches the PR base repo', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch', githubRepo: 'someone/else' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });

  it('returns needsPick when no remote matches and multiple remotes are ambiguous', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN, UPSTREAM] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch', githubRepo: 'someone/else' });
    assert.deepStrictEqual(result, { needsPick: [ORIGIN, UPSTREAM] });
  });

  it('falls back to plain resolveRemote when no githubRepo is provided', async () => {
    const git = makeFakeGit({ remotes: [ORIGIN] });
    const result = await resolveGitHubRemote(git, { purpose: 'fetch' });
    assert.deepStrictEqual(result, { remote: 'origin' });
  });
});

function makeFakeGitBin(stdout: string): { fakeBin: string } {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-remote-'));
  const gitPath = path.join(fakeBin, 'git');
  const escaped = stdout.replace(/'/g, `'\\''`);
  fs.writeFileSync(
    gitPath,
    ['#!/bin/sh', `printf '%s' '${escaped}'`, 'exit 0', ''].join('\n'),
    { mode: 0o755 }
  );
  return { fakeBin };
}

describe('GitExecutor.listRemotes (git remote -v parsing)', () => {
  it('parses fetch and push URLs, including divergent URLs, SSH/HTTPS forms, and stray whitespace', async () => {
    const output = [
      'origin  https://github.com/me/fork.git (fetch)',
      'origin\tgit@github.com:me/fork-push.git (push)',
      'upstream\tgit@github.com:acme/canonical.git (fetch)',
      'upstream\tgit@github.com:acme/canonical.git (push)',
      '',
    ].join('\n');

    const { fakeBin } = makeFakeGitBin(output);
    const oldPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;

    try {
      const git = new GitExecutor(fakeBin, mockLogService as unknown as LoggingService);
      const remotes = await git.listRemotes();

      assert.deepStrictEqual(remotes, [
        { name: 'origin', fetchUrl: 'https://github.com/me/fork.git', pushUrl: 'git@github.com:me/fork-push.git' },
        { name: 'upstream', fetchUrl: 'git@github.com:acme/canonical.git', pushUrl: 'git@github.com:acme/canonical.git' },
      ]);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});
