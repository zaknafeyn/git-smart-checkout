import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CancellationToken, env, ProgressLocation, Uri, window } from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { GitHubClient } from '../common/api/ghClient';
import { ConfigurationManager } from '../configuration/configurationManager';
import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { PrCloneData } from './prCloneService';
import { setContextShowPRClone, setContextShowPRCommits } from '../utils/setContext';
import { PrCloneServiceBase } from './prCloneServiceBase';
import { WorktreeSetupService } from './worktreeSetupService';

const TEMP_WORKDIR_PREFIX = `${EXTENSION_NAME}-pr-clone`;

export function isExistingExtensionTempWorktree(worktree: string, tempDir: string): boolean {
  try {
    if (!fs.existsSync(worktree) || !fs.lstatSync(worktree).isDirectory()) {
      return false;
    }
    const relativePath = path.relative(tempDir, worktree);
    return (
      relativePath !== '' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath) &&
      path.basename(worktree).startsWith(`${TEMP_WORKDIR_PREFIX}-`)
    );
  } catch {
    return false;
  }
}

export class OperationCancelledError extends Error {
  constructor() {
    super('PR clone cancelled');
    this.name = 'OperationCancelledError';
  }
}

function throwIfCancellationRequested(token: CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new OperationCancelledError();
  }
}

export class PrCloneTempWorktreeService extends PrCloneServiceBase {
  private tempWorkspacePath?: string;
  private tempGit?: GitExecutor;

  constructor(
    git: GitExecutor,
    ghClient: GitHubClient,
    loggingService: LoggingService,
    private readonly configManager?: ConfigurationManager,
    private readonly worktreeSetupService?: WorktreeSetupService
  ) {
    super(git, ghClient, loggingService, configManager);
  }

  async clonePR(data: PrCloneData): Promise<void> {
    let tempPath: string | undefined;
    let createdBranchName: string | undefined;
    this.loggingService.debug('Start cloning PR using temp worktree...');

    try {
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `Cloning PR #${data.prData.number}`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Step 1: Create temporary worktree
            progress.report({ message: 'Creating temporary worktree...' });
            tempPath = await this.createTempWorktree(data.targetBranch);

            throwIfCancellationRequested(token);

            // Optional: apply worktree setup (local file copy / setup command) to
            // the temp worktree too, but only when explicitly opted in — this is a
            // short-lived worktree, so setup runs best-effort and never blocks cloning.
            await this.maybeRunWorktreeSetup(tempPath);

            throwIfCancellationRequested(token);

            // Step 2: Fetch the target branch and the PR's commits (works for forks too)
            progress.report({ message: `Fetching PR #${data.prData.number} commits...` });
            await this.fetchAllBranches(data.targetBranch, data.prData.number, data.prData.base?.repo?.full_name);

            throwIfCancellationRequested(token);

            // Step 3: Create and validate branch name
            progress.report({ message: 'Creating feature branch...' });
            const finalBranchName = await this.createUniqueFeatureBranch(
              data.featureBranch,
              data.targetBranch
            );
            createdBranchName = finalBranchName;

            throwIfCancellationRequested(token);

            // Step 4: Cherry-pick commits
            progress.report({ message: 'Cherry-picking selected commits...' });
            await this.cherryPickCommits(data.selectedCommits, token);

            throwIfCancellationRequested(token);

            // Step 5: Push branch to GitHub
            progress.report({ message: 'Pushing branch to GitHub...' });
            const pushRemote = await this.resolvePrCloneRemote({
              branch: finalBranchName,
              purpose: 'push',
              githubRepo: data.prData.head?.repo?.full_name ?? data.prData.base?.repo?.full_name,
            });
            await this.tempGit?.pushBranchToGitHub(finalBranchName, pushRemote);

            throwIfCancellationRequested(token);

            // Step 6: Create PR
            progress.report({ message: 'Creating pull request...' });
            const newPr = await this.createGitHubPR(
              data.prData,
              finalBranchName,
              data.targetBranch,
              data.description,
              data.isDraft
            );

            throwIfCancellationRequested(token);

            // Step 7: Show success notification
            const openAction = await window.showInformationMessage(
              `PR #${newPr.number} created successfully!`,
              'Open'
            );

            if (openAction === 'Open') {
              await env.openExternal(Uri.parse(newPr.html_url));
            }

            // Step 8: Hide activity bar
            await this.hideActivityBar();
          } catch (error) {
            progress.report({ message: 'Error occurred during PR cloning, reverting changes ...' });
            throw error;
          }
        }
      );
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        this.loggingService.info('PR clone cancelled by user');
      } else {
        this.loggingService.error(`PR cloning failed: ${error}`);
      }

      // Clean up created branch if it exists and operation failed
      if (createdBranchName && this.tempWorkspacePath) {
        try {
          this.loggingService.info(`Cleaning up created branch: ${createdBranchName}`);
          await this.tempGit?.deleteLocalBranch(createdBranchName);
        } catch (cleanupError) {
          this.loggingService.warn(
            `Failed to cleanup branch ${createdBranchName}: ${cleanupError}`
          );
        }
      }

      if (error instanceof OperationCancelledError) {
        window.showInformationMessage('PR clone cancelled');
      } else {
        window.showErrorMessage(
          `Failed to clone PR: ${error instanceof Error ? error.message : error}`
        );
      }
    } finally {
      // Step 9: Cleanup temp worktree
      if (tempPath) {
        await this.cleanupTempWorktree(tempPath);
        this.cleanUp();
      }
    }
  }

  public cherryPickNext(): Promise<void> {
    throw new Error('Method is not supported for cloning in temp directory.');
  }

  protected async cleanUp(): Promise<void> {
    for (const action of this.cleanUpActionBegin) {
      await action();
    }
    for (const action of this.cleanUpActionEnd) {
      await action();
    }
  }

  private async maybeRunWorktreeSetup(tempPath: string): Promise<void> {
    if (!this.configManager || !this.worktreeSetupService) {
      return;
    }

    if (!this.configManager.get().worktreeSetup.applyToPrCloneWorktrees) {
      return;
    }

    try {
      await this.worktreeSetupService.runSetup(this.git.repositoryPath, tempPath);
    } catch (error) {
      this.loggingService.warn(`Worktree setup failed for PR clone temp worktree: ${error}`);
    }
  }

  private async createTempWorktree(targetBranch: string): Promise<string> {
    const tempDir = os.tmpdir();
    const workspaceName = `${TEMP_WORKDIR_PREFIX}-${Date.now()}`;
    const tempPath = path.join(tempDir, workspaceName);

    this.loggingService.info(`Creating temp worktree at: ${tempPath}`);

    await this.git.worktreeAdd(tempPath, targetBranch);

    this.tempWorkspacePath = tempPath;
    this.tempGit = new GitExecutor(tempPath, this.loggingService);

    return tempPath;
  }

  private async fetchAllBranches(targetBranch: string, prNumber: number, githubRepo?: string): Promise<void> {
    if (!this.tempGit) {
      throw new Error('Temporary git workspace not initialized');
    }

    const remoteName = await this.resolvePrCloneRemote({ branch: targetBranch, purpose: 'fetch', githubRepo });

    // Fetch only the target branch here — force-fetching all tags as a side
    // effect of cloning a PR can silently overwrite local tags that diverged
    // from the remote. The PR head fetch below is sufficient to get the
    // commits we need (works for forks too).
    await this.tempGit.fetchSpecificBranch(targetBranch, remoteName);

    try {
      await this.tempGit.fetchPullRequestHead(prNumber, remoteName);
    } catch (fetchError) {
      throw new Error(`Could not fetch the PR's commits from GitHub: ${fetchError}`);
    }
  }

  private async createUniqueFeatureBranch(
    baseBranchName: string,
    targetBranch: string
  ): Promise<string> {
    if (!this.tempGit) {
      throw new Error('Temporary git workspace not initialized');
    }

    let branchName = baseBranchName;
    let suffix = 1;

    // Check if branch already exists
    while (await this.tempGit.branchExist(branchName)) {
      branchName = `${baseBranchName}_${suffix}`;
      suffix++;
    }

    // Show notification if suffix was added
    if (suffix > 1) {
      window.showInformationMessage(
        `Branch name '${baseBranchName}' already exists. Using '${branchName}' instead.`
      );
    }

    await this.tempGit.createBranch(branchName, targetBranch);
    this.loggingService.info(`Created feature branch: ${branchName}`);

    return branchName;
  }

  private async cherryPickCommits(commitShas: string[], token: CancellationToken): Promise<void> {
    if (!this.tempGit) {
      throw new Error('Temporary git workspace not initialized');
    }

    this.loggingService.info('cherryPickCommits:', commitShas);

    const orderedCommits = [...commitShas];
    this.loggingService.info('Cherry-picking commits in GitHub API order:', orderedCommits);

    throwIfCancellationRequested(token);

    for (const sha of orderedCommits) {
      if (!(await this.tempGit.commitExists(sha))) {
        throw new Error(`Commit ${sha} is not available locally`);
      }
    }

    try {
      await this.tempGit.cherryPick(orderedCommits, false, 'skip');
    } catch (error) {
      throw new Error(
        `Failed to cherry-pick commit${orderedCommits.length > 1 ? 's' : ''}: ${error}`
      );
    }
  }

  private async createGitHubPR(
    originalPr: GitHubPR,
    featureBranch: string,
    targetBranch: string,
    description: string,
    isDraft: boolean
  ): Promise<GitHubPR> {
    const prBody = description;
    const labels = originalPr.labels?.map((label) => label.name) || [];
    const assignees = originalPr.assignees?.map((assignee) => assignee.login) || [];

    // Extract reviewers/team reviewers from original PR, excluding the
    // authenticated user (GitHub rejects requesting a review from the PR author).
    const currentUserLogin = await this.ghClient.getCurrentUserLogin();
    const reviewers = (originalPr.requested_reviewers?.map((reviewer) => reviewer.login) || []).filter(
      (login) => login !== currentUserLogin
    );
    const teamReviewers = originalPr.requested_teams?.map((team) => team.slug) || [];

    // Create PR using the GitHub API
    const newPr = await this.ghClient.createPullRequest(
      originalPr.title, // Use original PR title
      prBody,
      featureBranch,
      targetBranch,
      isDraft,
      labels,
      assignees,
      reviewers,
      teamReviewers
    );

    this.loggingService.info(`Created PR #${newPr.number}: ${newPr.title}`);
    return newPr;
  }

  private async hideActivityBar(): Promise<void> {
    await setContextShowPRClone(false);
    await setContextShowPRCommits(false);
  }

  private async cleanupTempWorktree(
    tempPath: string,
    cleanUpOtherTempWorktrees: boolean = true
  ): Promise<void> {
    try {
      this.loggingService.info(`Cleaning up temp worktree: ${tempPath}`);
      await this.git.worktreeRemove(tempPath);
    } catch (error) {
      this.loggingService.warn(`Failed to unregister temp worktree: ${error}`);
    }

    try {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
      }
    } catch (error) {
      this.loggingService.warn(`Failed to remove temp worktree directory: ${error}`);
    }

    if (cleanUpOtherTempWorktrees) {
      await this.cleanupOtherTempWorktrees();
    }
  }

  private async cleanupOtherTempWorktrees(): Promise<void> {
    try {
      const tempDir = os.tmpdir();

      await this.git.worktreePrune();

      // Get list of all git worktrees
      const allWorktrees: string[] = await this.git.worktreeList(true);
      const tempWorktrees = allWorktrees.filter((worktree) =>
        isExistingExtensionTempWorktree(worktree, tempDir)
      );
      await Promise.all(
        tempWorktrees.map(async (worktree) => {
          try {
            await this.git.worktreeRemove(worktree);
          } catch (error) {
            this.loggingService.warn(`Failed to cleanup stale temp worktree ${worktree}: ${error}`);
          }
        })
      );
    } catch (error) {
      this.loggingService.warn(`Failed to cleanup other temp worktrees: ${error}`);
    }
  }

  dispose(): void {
    if (this.tempWorkspacePath) {
      this.cleanupTempWorktree(this.tempWorkspacePath).catch((error) => {
        this.loggingService.warn(`Failed to cleanup on dispose: ${error}`);
      });
    }

    this.cleanUpActionEnd = [];
    this.cleanUpActionBegin = [];
  }
}
