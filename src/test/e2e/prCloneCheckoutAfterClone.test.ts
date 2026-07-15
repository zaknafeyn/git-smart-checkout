import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as vscode from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { PrCloneData } from '../../services/prCloneService';
import { PrCloneInPlaceService } from '../../services/prCloneInPlaceService';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { GitHubPR } from '../../types/dataTypes';

import { createPRTestRepo, PRTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

/**
 * Real-repo end-to-end coverage for Feature 9 (issue #29):
 * `git-smart-checkout.prClone.checkoutAfterClone`. Drives the actual
 * PrCloneInPlaceService / PrCloneTempWorktreeService against a real git repo +
 * bare "GitHub" remote (only the GitHub REST API calls are stubbed), then
 * inspects real git state (current branch, stash list, worktree list).
 */

type CheckoutAfterClone = 'ask' | 'always' | 'never';

function makeConfigManager(
  checkoutAfterClone: CheckoutAfterClone,
  defaultWorktreeDirectory = ''
): ConfigurationManager {
  return {
    get: () => ({
      prClone: { checkoutAfterClone },
      defaultWorktreeDirectory,
    }),
  } as unknown as ConfigurationManager;
}

/** Publishes the repo's `prBranch` under the synthetic GitHub `pull/<n>/head` ref used by
 * `fetchPullRequestHead`, and returns the PR's head commit sha + a matching GitHubPR payload.
 * `createPRTestRepo` already pushed `prBranch` to origin and deleted the local branch (to
 * simulate a PR branch that only exists on the remote), so the source ref for `update-ref`
 * comes from the local remote-tracking ref, and the synthetic ref is written directly on the
 * bare remote (equivalent to what GitHub does server-side when a PR is opened). */
function publishPrHead(repo: PRTestRepo, prNumber: number): { sha: string; prData: GitHubPR } {
  const sha = execSync(`git rev-parse origin/${repo.prBranch}`, {
    cwd: repo.repoPath,
    encoding: 'utf-8',
  }).trim();
  execSync(`git update-ref refs/pull/${prNumber}/head ${sha}`, {
    cwd: repo.remoteRepoPath,
    stdio: 'pipe',
  });

  const prData = {
    number: prNumber,
    title: 'Test PR',
    body: '',
    head: { ref: repo.prBranch, sha, repo: { full_name: 'owner/repo', clone_url: '' } },
    base: { ref: repo.mainBranch, repo: { full_name: 'owner/repo' } },
    html_url: `https://github.com/owner/repo/pull/${prNumber}`,
    labels: [],
    assignees: [],
  } as unknown as GitHubPR;

  return { sha, prData };
}

function makeGhClientStub(prData: GitHubPR): GitHubClient {
  return {
    getCurrentUserLogin: async () => 'tester',
    createPullRequest: async () => ({ ...prData, number: prData.number + 1 }),
  } as unknown as GitHubClient;
}

function stubShowInformationMessage(response: string | undefined): () => void {
  const original = vscode.window.showInformationMessage;
  (vscode.window as any).showInformationMessage = async () => response;
  return () => {
    (vscode.window as any).showInformationMessage = original;
  };
}

function worktreePaths(repo: PRTestRepo): string[] {
  const out = execSync('git worktree list --porcelain', { cwd: repo.repoPath, encoding: 'utf-8' });
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

describe('PR Clone e2e: prClone.checkoutAfterClone (in-place strategy)', () => {
  it('always: stays on the cloned branch and keeps the user\'s WIP stashed', async () => {
    const repo = createPRTestRepo();
    const { sha, prData } = publishPrHead(repo, 501);

    // Dirty the working tree so the clone auto-stashes it.
    repo.makeChange('file1.txt', 'work in progress\n');

    const service = new PrCloneInPlaceService(
      repo.git,
      makeGhClientStub(prData),
      mockLogService,
      undefined,
      makeConfigManager('always')
    );

    const restoreInfo = stubShowInformationMessage(undefined);
    try {
      const data: PrCloneData = {
        prData,
        targetBranch: repo.mainBranch,
        featureBranch: 'feature_clone',
        description: '',
        selectedCommits: [sha],
        isDraft: false,
      };

      await service.clonePR(data);

      assert.strictEqual(
        repo.exec('git branch --show-current').trim(),
        'feature_clone',
        'must stay on the newly cloned branch, not restore the original'
      );
      assert.strictEqual(repo.stashCount(), 1, 'the WIP auto-stash must survive');
    } finally {
      restoreInfo();
      repo.cleanup();
    }
  });

  it('ask + dismiss: restores the original branch and pops the WIP stash back', async () => {
    const repo = createPRTestRepo();
    const { sha, prData } = publishPrHead(repo, 502);

    repo.makeChange('file1.txt', 'work in progress\n');

    const service = new PrCloneInPlaceService(
      repo.git,
      makeGhClientStub(prData),
      mockLogService,
      undefined,
      makeConfigManager('ask')
    );

    // Dismissing every prompt (including the checkoutAfterClone ask) resolves to `undefined`.
    const restoreInfo = stubShowInformationMessage(undefined);
    try {
      const data: PrCloneData = {
        prData,
        targetBranch: repo.mainBranch,
        featureBranch: 'feature_clone',
        description: '',
        selectedCommits: [sha],
        isDraft: false,
      };

      await service.clonePR(data);

      assert.strictEqual(
        repo.exec('git branch --show-current').trim(),
        repo.mainBranch,
        'dismissing the ask prompt must restore the original branch'
      );
      assert.strictEqual(repo.stashCount(), 0, 'the WIP stash must be popped back onto the original branch');
      assert.strictEqual(repo.readFile('file1.txt'), 'work in progress\n', 'the WIP content itself must be restored');
    } finally {
      restoreInfo();
      repo.cleanup();
    }
  });
});

describe('PR Clone e2e: prClone.checkoutAfterClone (temp-worktree strategy)', () => {
  it('always: worktree survives under the configured base directory', async () => {
    const repo = createPRTestRepo();
    const { sha, prData } = publishPrHead(repo, 503);
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-checkout-base-'));

    const service = new PrCloneTempWorktreeService(
      repo.git,
      makeGhClientStub(prData),
      mockLogService,
      makeConfigManager('always', baseDir)
    );

    const restoreInfo = stubShowInformationMessage(undefined);
    try {
      const data: PrCloneData = {
        prData,
        targetBranch: repo.mainBranch,
        featureBranch: 'feature_clone',
        description: '',
        selectedCommits: [sha],
        isDraft: false,
      };

      await service.clonePR(data);

      // Compare via realpath: on macOS, os.tmpdir() ("/var/folders/...") and git's reported
      // worktree paths ("/private/var/folders/...") differ only by a symlink resolution.
      const realBaseDir = fs.realpathSync(baseDir);
      const worktrees = worktreePaths(repo);
      const kept = worktrees.find((p) => path.dirname(fs.realpathSync(p)) === realBaseDir);
      assert.ok(
        kept,
        `expected a kept worktree under ${realBaseDir}, got: ${JSON.stringify(worktrees)}`
      );
      assert.ok(fs.existsSync(kept!), 'the kept worktree directory must actually exist on disk');
      assert.ok(
        !worktrees.some((p) => p !== kept && path.basename(p).includes('pr-clone')),
        `no stray PR-clone worktree should remain outside the base directory, got: ${JSON.stringify(worktrees)}`
      );
    } finally {
      restoreInfo();
      repo.cleanup();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('never: worktree is torn down after clone (regression guard)', async () => {
    const repo = createPRTestRepo();
    const { sha, prData } = publishPrHead(repo, 504);

    const service = new PrCloneTempWorktreeService(
      repo.git,
      makeGhClientStub(prData),
      mockLogService,
      makeConfigManager('never')
    );

    const restoreInfo = stubShowInformationMessage(undefined);
    try {
      const data: PrCloneData = {
        prData,
        targetBranch: repo.mainBranch,
        featureBranch: 'feature_clone',
        description: '',
        selectedCommits: [sha],
        isDraft: false,
      };

      await service.clonePR(data);

      const worktrees = worktreePaths(repo);
      assert.ok(
        !worktrees.some((p) => p.includes('pr-clone')),
        `expected no surviving PR-clone worktree, got: ${JSON.stringify(worktrees)}`
      );
    } finally {
      restoreInfo();
      repo.cleanup();
    }
  });
});
