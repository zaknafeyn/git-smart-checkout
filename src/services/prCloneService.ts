import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CancellationToken, commands, env, ProgressLocation, Uri, window } from 'vscode';

import { GitHubClient } from '../common/api/ghClient';
import { GitExecutor } from '../common/git/gitExecutor';
import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { getStashMessage } from '../commands/utils/getStashMessage';
import { ConfigurationManager } from '../configuration/configurationManager';

export interface PrCloneData {
  prData: GitHubPR;
  targetBranch: string;
  featureBranch: string;
  description: string;
  selectedCommits: string[];
  isDraft: boolean;
}

const TEMP_WORKDIR_PREFIX = `${EXTENSION_NAME}-pr-clone`;

export class PrCloneService {
  private tempWorkspacePath?: string;
  private tempGit?: GitExecutor;

  constructor(
    private git: GitExecutor,
    private ghClient: GitHubClient,
    private loggingService: LoggingService,
    private configurationManager: ConfigurationManager
  ) {}

  // async openMergeEditorFor(filePath: Uri) {
  //   // await commands.executeCommand('vscode.openMergeEditor', filePath);
  //   await commands.executeCommand('_open.mergeEditor', filePath);
  // }

  async clonePR(data: PrCloneData): Promise<void> {
    const config = this.configurationManager.get();
    
    if (config.useInPlaceCherryPick) {
      await this.clonePRInPlace(data);
    } else {
      await this.clonePRWithTempWorktree(data);
    }
  }

  private async clonePRWithTempWorktree(data: PrCloneData): Promise<void> {
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

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 2: Pull all branches
            progress.report({ message: 'Fetching latest branches...' });
            await this.fetchAllBranches();

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 3: Create and validate branch name
            progress.report({ message: 'Creating feature branch...' });
            const finalBranchName = await this.createUniqueFeatureBranch(
              data.featureBranch,
              data.targetBranch
            );
            createdBranchName = finalBranchName;

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 4: Cherry-pick commits
            progress.report({ message: 'Cherry-picking selected commits...' });
            await this.cherryPickCommits(data.selectedCommits, token);

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 5: Push branch to GitHub
            progress.report({ message: 'Pushing branch to GitHub...' });
            await this.tempGit?.pushBranchToGitHub(finalBranchName);

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 6: Create PR
            progress.report({ message: 'Creating pull request...' });
            const newPr = await this.createGitHubPR(
              data.prData,
              finalBranchName,
              data.targetBranch,
              data.description,
              data.isDraft
            );

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

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
      this.loggingService.error(`PR cloning failed: ${error}`);

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

      window.showErrorMessage(
        `Failed to clone PR: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      // Step 9: Cleanup temp worktree
      if (tempPath) {
        await this.cleanupTempWorktree(tempPath);
      }
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

  private async fetchAllBranches(): Promise<void> {
    if (!this.tempGit) {
      throw new Error('Temporary git workspace not initialized');
    }

    await this.tempGit.fetchAllRemoteBranchesAndTags();
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
    // await this.tempGit.checkout(branchName);
    this.loggingService.info(`Created feature branch: ${branchName}`);

    return branchName;
  }

  private async cherryPickCommits(commitShas: string[], token: CancellationToken): Promise<void> {
    if (!this.tempGit) {
      throw new Error('Temporary git workspace not initialized');
    }

    this.loggingService.info('cherryPickCommits:', commitShas);

    // Sort commits by creation date to ensure proper chronological order
    // Get commit details to access creation dates
    const commitDetails = await Promise.all(
      commitShas.map(async (sha) => this.tempGit!.getCommitTimestamp(sha))
    );

    // Sort by timestamp (creation date) in ascending order (oldest first)
    const sortedCommits = commitDetails
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((commit) => commit.sha);

    this.loggingService.info('Cherry-picking commits in chronological order:', sortedCommits);

    if (token.isCancellationRequested) {
      throw new Error('Cancel operation');
    }

    try {
      await this.tempGit.cherryPick(sortedCommits);
    } catch (error) {
      throw new Error(
        `Failed to cherry-pick commit${sortedCommits.length > 1 ? 's' : ''}: ${error}`
      );
    }

    // for (const commitSha of sortedCommits) {
    //   if (token.isCancellationRequested) {
    //     throw new Error('Cancel operation');
    //   }

    //   try {
    //     await this.tempGit.cherryPick(commitSha);

    //     this.loggingService.info(`Cherry-picked commit: ${commitSha}`);
    //   } catch (error) {
    //     // const uri = Uri.joinPath(Uri.parse(this.tempWorkspacePath || ''), 'README.md');
    //     // await this.openMergeEditorFor(uri);

    //     throw new Error(`Failed to cherry-pick commit ${commitSha}: ${error}`);
    //   }
    // }
  }

  private async createGitHubPR(
    originalPr: GitHubPR,
    featureBranch: string,
    targetBranch: string,
    description: string,
    isDraft: boolean
  ): Promise<GitHubPR> {
    const prBody = description;

    // Create PR using the GitHub API
    const newPr = await this.ghClient.createPullRequest(
      originalPr.title, // Use original PR title
      prBody,
      featureBranch,
      targetBranch,
      isDraft
    );

    this.loggingService.info(`Created PR #${newPr.number}: ${newPr.title}`);
    return newPr;
  }

  private async hideActivityBar(): Promise<void> {
    const { commands } = await import('vscode');
    await commands.executeCommand('setContext', `${EXTENSION_NAME}.showPrClone`, false);
    await commands.executeCommand('setContext', `${EXTENSION_NAME}.showPrCommits`, false);
  }

  private async cleanupTempWorktree(
    tempPath: string,
    cleanUpOtherTempWorktrees: boolean = true
  ): Promise<void> {
    try {
      this.loggingService.info(`Cleaning up temp worktree: ${tempPath}`);
      await this.git.worktreeRemove(tempPath);

      // Ensure directory is removed if it still exists
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
      }

      // Clean up other temporary worktrees if enabled
      if (cleanUpOtherTempWorktrees) {
        await this.cleanupOtherTempWorktrees();
      }
    } catch (error) {
      this.loggingService.warn(`Failed to cleanup temp worktree: ${error}`);
    }
  }

  private async cleanupOtherTempWorktrees(): Promise<void> {
    try {
      const tempDir = os.tmpdir();

      // Get list of all git worktrees
      const allWorktrees: string[] = await this.git.worktreeList(true);
      const tempWorktrees = allWorktrees.filter((worktree) => {
        return (
          fs.lstatSync(worktree).isDirectory() &&
          worktree.includes(tempDir) &&
          worktree.includes(TEMP_WORKDIR_PREFIX)
        );
      });
      const tempWorktreesPromises = tempWorktrees.map((worktree) =>
        this.git.worktreeRemove(worktree)
      );

      // remove all worktrees crated by extension
      await Promise.all(tempWorktreesPromises);
    } catch (error) {
      this.loggingService.warn(`Failed to cleanup other temp worktrees: ${error}`);
    }
  }

  private async clonePRInPlace(data: PrCloneData): Promise<void> {
    let stashMessage: string | undefined;
    let originalBranch: string | undefined;
    let createdBranchName: string | undefined;

    this.loggingService.debug('Start cloning PR using in-place cherry-pick...');

    try {
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `Cloning PR #${data.prData.number} (In-Place)`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Step 1: Store original branch and stash changes if needed
            originalBranch = await this.git.getCurrentBranch();
            progress.report({ message: 'Checking for uncommitted changes...' });
            
            const hasUncommittedChanges = await this.git.isWorkdirHasChanges();
            if (hasUncommittedChanges) {
              stashMessage = getStashMessage(originalBranch, true);
              this.loggingService.info(`Stashing uncommitted changes: ${stashMessage}`);
              
              try {
                await this.git.createStash(stashMessage);
                this.loggingService.info('Changes stashed successfully');
              } catch (error) {
                this.loggingService.warn(`Failed to stash changes: ${error}`);
                stashMessage = undefined;
              }
            }

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 2: Fetch the PR's origin branch
            progress.report({ message: `Fetching PR branch: ${data.prData.head.ref}...` });
            try {
              await this.git.fetchSpecificBranch(data.prData.head.ref);
              this.loggingService.info(`Fetched PR branch: ${data.prData.head.ref}`);
            } catch (fetchError) {
              this.loggingService.warn(`Failed to fetch PR branch: ${fetchError}`);
            }

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 3: Switch to base branch and pull latest changes
            progress.report({ message: `Switching to base branch: ${data.targetBranch}...` });
            await this.git.checkout(data.targetBranch);
            
            progress.report({ message: 'Pulling latest changes...' });
            try {
              await this.git.pullCurrentBranch();
              this.loggingService.info(`Pulled latest changes for ${data.targetBranch}`);
            } catch (pullError) {
              this.loggingService.warn(`Failed to pull latest changes: ${pullError}`);
            }

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 4: Create unique feature branch
            progress.report({ message: 'Creating feature branch...' });
            createdBranchName = await this.git.createUniqueFeatureBranch(
              data.featureBranch,
              data.targetBranch
            );
            
            if (createdBranchName !== data.featureBranch) {
              window.showInformationMessage(
                `Branch name '${data.featureBranch}' already exists. Using '${createdBranchName}' instead.`
              );
            }

            await this.git.checkout(createdBranchName);
            this.loggingService.info(`Created and switched to feature branch: ${createdBranchName}`);

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 5: Cherry-pick commits
            progress.report({ message: 'Cherry-picking selected commits...' });
            await this.cherryPickCommitsInPlace(data.selectedCommits, token);

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 6: Push branch to GitHub
            progress.report({ message: 'Pushing branch to GitHub...' });
            await this.git.pushBranchToGitHub(createdBranchName);

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 7: Create PR
            progress.report({ message: 'Creating pull request...' });
            const newPr = await this.createGitHubPR(
              data.prData,
              createdBranchName,
              data.targetBranch,
              data.description,
              data.isDraft
            );

            if (token.isCancellationRequested) {
              throw new Error('Cancel operation');
            }

            // Step 8: Show success notification
            const openAction = await window.showInformationMessage(
              `PR #${newPr.number} created successfully!`,
              'Open'
            );

            if (openAction === 'Open') {
              await env.openExternal(Uri.parse(newPr.html_url));
            }

            // Step 9: Hide activity bar
            await this.hideActivityBar();
          } catch (error) {
            progress.report({ message: 'Error occurred during PR cloning, reverting changes ...' });
            throw error;
          }
        }
      );
    } catch (error) {
      this.loggingService.error(`In-place PR cloning failed: ${error}`);

      // Clean up created branch if it exists and operation failed
      if (createdBranchName) {
        try {
          this.loggingService.info(`Cleaning up created branch: ${createdBranchName}`);
          // Switch back to original branch first
          if (originalBranch) {
            await this.git.checkout(originalBranch);
          }
          await this.git.deleteLocalBranch(createdBranchName);
        } catch (cleanupError) {
          this.loggingService.warn(
            `Failed to cleanup branch ${createdBranchName}: ${cleanupError}`
          );
        }
      }

      window.showErrorMessage(
        `Failed to clone PR: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      // Step 10: Switch back to original branch
      if (originalBranch) {
        try {
          await this.git.checkout(originalBranch);
          this.loggingService.info(`Switched back to original branch: ${originalBranch}`);
        } catch (checkoutError) {
          this.loggingService.warn(`Failed to switch back to original branch: ${checkoutError}`);
        }
      }

      // Step 11: Restore stashed changes if they were created
      if (stashMessage) {
        try {
          const isStashExists = await this.git.isStashWithMessageExists(stashMessage);
          
          if (isStashExists) {
            this.loggingService.info(`Restoring stashed changes: ${stashMessage}`);
            await this.git.popStash(stashMessage);
            this.loggingService.info('Stashed changes restored successfully');
          }
        } catch (error) {
          this.loggingService.warn(`Failed to restore stashed changes: ${error}`);
          window.showWarningMessage(
            'Failed to restore your previously stashed changes. Please check your git stash list manually.'
          );
        }
      }
    }
  }

  private async cherryPickCommitsInPlace(commitShas: string[], token: CancellationToken): Promise<void> {
    this.loggingService.info('cherryPickCommitsInPlace:', commitShas);

    // Sort commits by creation date to ensure proper chronological order
    const commitDetails = await Promise.all(
      commitShas.map(async (sha) => this.git.getCommitTimestamp(sha))
    );

    const sortedCommits = commitDetails
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((commit) => commit.sha);

    this.loggingService.info('Cherry-picking commits in chronological order:', sortedCommits);

    if (token.isCancellationRequested) {
      throw new Error('Cancel operation');
    }

    try {
      // Cherry-pick all commits at once
      await this.git.cherryPick(sortedCommits);
    } catch (error) {
      // Handle conflicts - show a message and let the user resolve manually
      const errorMessage = `Cherry-pick conflicts detected. Please resolve conflicts manually in VS Code and continue the cherry-pick process using VS Code's built-in Git capabilities.`;
      
      this.loggingService.error(`Cherry-pick failed with conflicts: ${error}`);
      
      const continueAction = 'OK';
      await window.showWarningMessage(
        errorMessage,
        { modal: true },
        continueAction
      );
      
      // The cherry-pick process is now in the user's hands
      // They need to resolve conflicts manually and continue
      throw new Error('Cherry-pick conflicts require manual resolution');
    }
  }

  dispose(): void {
    if (this.tempWorkspacePath) {
      this.cleanupTempWorktree(this.tempWorkspacePath).catch((error) => {
        this.loggingService.warn(`Failed to cleanup on dispose: ${error}`);
      });
    }
  }
}
