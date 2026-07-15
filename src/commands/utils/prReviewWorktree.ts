import * as fs from 'fs';
import * as path from 'path';

import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitWorktree } from '../../common/git/types';
import { PRReviewWorktreeStore } from '../../services/prReviewWorktreeStore';
import { GitHubPR } from '../../types/dataTypes';

/**
 * Shared core of the PR-review worktree commands (`prReviewInWorktree` and
 * `reviewPrByNumber`). Keeps store registration and worktree lookups in one
 * place so the two commands cannot drift apart.
 */

export interface PRReviewRepoInfo {
  owner: string;
  repo: string;
}

export async function recordPRReviewWorktree(
  store: PRReviewWorktreeStore | undefined,
  git: GitExecutor,
  repoInfo: PRReviewRepoInfo,
  pr: GitHubPR,
  worktreePath: string,
  branchName: string = pr.head.ref,
  headSha: string | undefined = pr.head.sha
): Promise<void> {
  await store?.upsert({
    repoKey: PRReviewWorktreeStore.createRepoKey(repoInfo.owner, repoInfo.repo, git.repositoryPath),
    repositoryPath: git.repositoryPath,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    worktreePath,
    branchName,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.html_url,
    headSha,
  });
}

export async function findWorktreeForBranch(
  git: GitExecutor,
  branchName: string
): Promise<IGitWorktree | undefined> {
  const expectedBranchRef = `refs/heads/${branchName}`;
  const worktrees = await git.worktreeListDetailed(true);

  return worktrees.find(
    (worktree) =>
      !worktree.bare &&
      !worktree.prunable &&
      worktree.branch === expectedBranchRef
  );
}

export function ensureWorktreeParentDirectory(worktreePath: string): void {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
}
