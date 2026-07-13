import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitExecutor } from '../../common/git/gitExecutor';
import { GitHubClient } from '../../common/api/ghClient';
import { LoggingService } from '../../logging/loggingService';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { PrCloneData } from '../../services/prCloneService';
import { GitHubPR } from '../../types/dataTypes';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeFakeGitBin(script: string[]): { fakeBin: string; gitLog: string } {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-fake-git-'));
  const gitLog = path.join(fakeBin, 'commands.log');
  const gitPath = path.join(fakeBin, 'git');
  fs.writeFileSync(gitPath, ['#!/bin/sh', ...script, ''].join('\n'), { mode: 0o755 });
  return { fakeBin, gitLog };
}

describe('GitExecutor fork-PR helpers', () => {
  it('fetchPullRequestHead fetches the synthetic pull/<n>/head ref from origin', async () => {
    const { fakeBin, gitLog } = makeFakeGitBin([
      'printf "%s\\n" "$*" >> "$GSC_GIT_TEST_LOG"',
      'exit 0',
    ]);
    const oldPath = process.env.PATH;
    const oldLog = process.env.GSC_GIT_TEST_LOG;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;
    process.env.GSC_GIT_TEST_LOG = gitLog;

    try {
      const git = new GitExecutor(fakeBin, mockLogService as unknown as LoggingService);
      await git.fetchPullRequestHead(42);

      assert.deepStrictEqual(
        fs.readFileSync(gitLog, 'utf8').trim().split('\n'),
        ['fetch origin pull/42/head']
      );
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

  it('commitExists reports true/false based on cat-file exit status', async () => {
    const { fakeBin } = makeFakeGitBin([
      'if [ "$1" = "cat-file" ] && [ "$3" = "present^{commit}" ]; then',
      '  exit 0',
      'fi',
      'exit 1',
    ]);
    const oldPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath ?? ''}`;

    try {
      const git = new GitExecutor(fakeBin, mockLogService as unknown as LoggingService);
      assert.strictEqual(await git.commitExists('present'), true);
      assert.strictEqual(await git.commitExists('missing'), false);
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});

const prData = {
  number: 71,
  title: 'Fork PR',
  head: { ref: 'source', sha: 'abc123', repo: { full_name: 'fork/repo', clone_url: '' } },
  base: { ref: 'main', repo: { full_name: 'owner/repo' } },
  labels: [],
  assignees: [],
} as unknown as GitHubPR;

const cloneData: PrCloneData = {
  prData,
  targetBranch: 'main',
  featureBranch: 'feature/clone',
  description: '',
  selectedCommits: ['abc123'],
  isDraft: false,
};

describe('PrCloneInPlaceService fork-PR fetch handling', () => {
  it('aborts the clone with a clear error when fetching the PR head fails', async () => {
    let cleanedUp = false;
    const git = {
      getCurrentBranch: async () => 'original',
      isWorkdirHasChanges: async () => false,
      fetchPullRequestHead: async () => {
        throw new Error('unknown revision or path not in the working tree');
      },
      isCherryPickInProgress: async () => false,
      checkout: async () => {
        cleanedUp = true;
      },
    } as unknown as GitExecutor;

    class TestService extends PrCloneInPlaceService {
      reportedError: unknown;
      protected override async showCloneError(error: unknown): Promise<void> {
        this.reportedError = error;
      }
    }

    const service = new TestService(git, {} as GitHubClient, mockLogService);

    await assert.rejects(service.clonePR(cloneData));

    assert.ok(cleanedUp, 'should restore the original branch during recovery');
    assert.match(
      String((service.reportedError as Error)?.message ?? service.reportedError),
      /Could not fetch the PR's commits from GitHub/
    );
  });

  it('aborts before cherry-picking when a selected commit is not available locally', async () => {
    const git = {
      getCurrentBranch: async () => 'original',
      isWorkdirHasChanges: async () => false,
      fetchPullRequestHead: async () => {},
      checkout: async () => {},
      pullCurrentBranch: async () => {},
      createUniqueFeatureBranch: async () => 'feature/clone',
      commitExists: async () => false,
      isCherryPickInProgress: async () => false,
    } as unknown as GitExecutor;

    class TestService extends PrCloneInPlaceService {
      reportedError: unknown;
      protected override async showCloneError(error: unknown): Promise<void> {
        this.reportedError = error;
      }
    }

    const service = new TestService(git, {} as GitHubClient, mockLogService);

    await assert.rejects(service.clonePR(cloneData));

    assert.match(
      String((service.reportedError as Error)?.message ?? service.reportedError),
      /Commit abc123 is not available locally/
    );
  });
});

describe('PrCloneTempWorktreeService fork-PR fetch handling', () => {
  it('surfaces a clear error when fetching the PR head fails', async () => {
    const service = new PrCloneTempWorktreeService(
      {} as GitExecutor,
      {} as GitHubClient,
      mockLogService
    );

    (service as any).tempGit = {
      fetchAllRemoteBranchesAndTags: async () => {},
      fetchPullRequestHead: async () => {
        throw new Error('couldn\'t find remote ref pull/71/head');
      },
    };

    await assert.rejects(
      (service as any).fetchAllBranches(71),
      /Could not fetch the PR's commits from GitHub/
    );
  });

  it('rejects cherry-picking when a selected commit is missing locally', async () => {
    const service = new PrCloneTempWorktreeService(
      {} as GitExecutor,
      {} as GitHubClient,
      mockLogService
    );

    (service as any).tempGit = {
      commitExists: async () => false,
      cherryPick: async () => {
        throw new Error('should not be called');
      },
    };

    await assert.rejects(
      (service as any).cherryPickCommits(['deadbeef'], { isCancellationRequested: false }),
      /Commit deadbeef is not available locally/
    );
  });
});
