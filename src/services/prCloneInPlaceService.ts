import { CancellationToken, commands, env, Progress, ProgressLocation, Uri, window } from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { GitHubClient } from '../common/api/ghClient';
import { EXTENSION_NAME } from '../const';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { getStashMessage } from '../commands/utils/getStashMessage';
import { ICleanUpActions, PrCloneData } from './prCloneService';
import { createWithProcess } from '../utils/createWithProcess';
import { CommitGeneratorItem, CommitsGenerator } from '../utils/commitsGenerator';
import {
  setContextIsCherryPickConflict,
  setContextIsCloning,
  setContextShowPRClone,
  setContextShowPRCommits,
} from '../utils/setContext';
import { PrCloneServiceBase } from './prCloneServiceBase';

interface IServiceStore {
  originalBranch?: string;
  createdBranchName?: string;
  stashMessage?: string;
  isAborting?: boolean;
}

export class PrCloneInPlaceService extends PrCloneServiceBase {
  private finishProgress: (() => void) | undefined;
  private cancelProgress: (() => void) | undefined;
  private updateProgress?: Progress<{ message?: string; increment?: number }>;
  private commitGenerator: AsyncGenerator<CommitGeneratorItem, void, unknown> | undefined;
  private serviceStore: IServiceStore = {};
  private cleanUpActionBegin: (() => void)[] = [];
  private cleanUpActionEnd: (() => void)[] = [];

  constructor(git: GitExecutor, ghClient: GitHubClient, loggingService: LoggingService) {
    super(git, ghClient, loggingService);
  }

  async cherryPickNext(isContinue = false) {
    // Step 5: Cherry-pick commits
    // progress.report({ message: 'Cherry-picking selected commits...' });
    // await this.cherryPickCommitsInPlace(data.selectedCommits, token);

    if (await this.git.hasConflicts()) {
      await window.showWarningMessage(
        'Working directory still has conflicts, resolve them to proceed',
        { modal: true }
      );

      return;
    }

    if (isContinue) {
      if (await this.git.isWorkdirHasChanges()) {
        await this.git.cherryPickContinue();
      } else {
        await this.git.cherryPickSkip();
      }
    }

    const nextCommit = await this.commitGenerator!.next();
    if (nextCommit?.done) {
      // proceed to creating a PR and clean up repository
      this.updateProgress?.report({ message: 'All commits were applied' });
      this.finishProgress?.();
    } else {
      // apply commit and proceed to the next commit
      this.updateProgress?.report({
        message: `Applying commit ${nextCommit.value.sha}, (${nextCommit.value.current} of ${nextCommit.value.total})`,
      });

      try {
        // Cherry-pick all commits at once
        const { conflicts } = (await this.git.cherryPick(nextCommit.value.sha, true)) || {
          conflicts: false,
        };

        if (conflicts) {
          setContextIsCherryPickConflict(true);
          this.updateProgress?.report({
            message: `There are conflicts on commit ${nextCommit.value.sha}, (${nextCommit.value.current} of ${nextCommit.value.total})`,
          });
          return;
        } else {
          await this.cherryPickNext();
        }
      } catch (error) {
        // Handle conflicts - show a message and let the user resolve manually
        const errorMessage = `Cannot apply cherry pick, reverting changes`;

        this.loggingService.error(`Cannot cherry-pick a commit '${nextCommit.value}': ${error}`);

        await window.showWarningMessage(errorMessage, { modal: true });

        // The cherry-pick process is now in the user's hands
        // They need to resolve conflicts manually and continue
        throw new Error('Cherry-pick conflicts require manual resolution');
      }
    }
  }

  addCleanUpActions({ cleanUpActionBegin, cleanUpActionEnd }: ICleanUpActions) {
    if (cleanUpActionBegin) {
      this.cleanUpActionBegin.push(cleanUpActionBegin);
    }

    if (cleanUpActionEnd) {
      this.cleanUpActionEnd.push(cleanUpActionEnd);
    }
  }

  async cleanUp(isAborting = false) {
    this.updateProgress?.report({ message: 'Clean up' });

    try {
      this.cleanUpActionBegin.forEach((action) => action());

      // Check if there's an active cherry-pick operation and abort it
      if (await this.git.isCherryPickInProgress()) {
        try {
          await this.git.cherryPickAbort();
          setContextIsCherryPickConflict(false);
        } catch (error) {
          this.loggingService.warn(`Failed to abort cherry-pick: ${error}`);
        }
      }

      // Hard reset to reset all changes in workdir
      try {
        await this.git.reset(true);
      } catch (error) {
        this.loggingService.warn(`Failed to reset working directory: ${error}`);
      }

      await setContextIsCloning(false);
      await setContextIsCherryPickConflict(false);

      if (!this.serviceStore.originalBranch) {
        return;
      }
      await this.git.checkout(this.serviceStore.originalBranch);

      if (this.serviceStore.stashMessage) {
        await this.git.popStash(this.serviceStore.stashMessage);
      }

      if (!this.serviceStore.isAborting && !isAborting) {
        return;
      }

      if (!this.serviceStore.createdBranchName) {
        return;
      }

      // if operation abort requested, clean up leftovers (new branch)
      await this.git.deleteLocalBranch(this.serviceStore.createdBranchName);
    } finally {
      this.cleanUpActionEnd.forEach((action) => action());
    }
  }

  async clonePR(data: PrCloneData): Promise<void> {
    this.loggingService.debug('Start cloning PR using in-place cherry-pick...');

    // branch to roll back after PR creation or cancels

    const { finishProgress, cancelProgress, updateProgress } = createWithProcess(
      `Cloning PR #${data.prData.number} (In-Place)`,
      this.cleanUp.bind(this)
    );

    this.finishProgress = finishProgress;
    this.cancelProgress = cancelProgress;
    this.updateProgress = updateProgress;

    try {
      // Step 1: Store original branch and stash changes if needed
      this.serviceStore.originalBranch = await this.git.getCurrentBranch();
      updateProgress?.report({ message: 'Checking for uncommitted changes...' });

      const hasUncommittedChanges = await this.git.isWorkdirHasChanges();
      if (hasUncommittedChanges) {
        this.serviceStore.stashMessage = getStashMessage(this.serviceStore.originalBranch, true);
        this.loggingService.info(`Stashing uncommitted changes: ${this.serviceStore.stashMessage}`);

        try {
          await this.git.createStash(this.serviceStore.stashMessage);
          this.loggingService.info('Changes stashed successfully');
        } catch (error) {
          this.loggingService.warn(`Failed to stash changes: ${error}`);
          this.serviceStore.stashMessage = undefined;
        }
      }

      // Step 2: Fetch the PR's origin branch
      updateProgress?.report({ message: `Fetching PR branch: ${data.prData.head.ref}...` });
      try {
        await this.git.fetchSpecificBranch(data.prData.head.ref);
        this.loggingService.info(`Fetched PR branch: ${data.prData.head.ref}`);
      } catch (fetchError) {
        this.loggingService.warn(`Failed to fetch PR branch: ${fetchError}`);
      }

      // Step 3: Switch to base branch and pull latest changes
      updateProgress?.report({ message: `Switching to base branch: ${data.targetBranch}...` });
      await this.git.checkout(data.targetBranch);

      updateProgress?.report({ message: 'Pulling latest changes...' });
      try {
        await this.git.pullCurrentBranch();
        this.loggingService.info(`Pulled latest changes for ${data.targetBranch}`);
      } catch (pullError) {
        this.loggingService.warn(`Failed to pull latest changes: ${pullError}`);
      }

      // Step 4: Create unique feature branch
      updateProgress?.report({ message: 'Creating feature branch...' });
      this.serviceStore.createdBranchName = await this.git.createUniqueFeatureBranch(
        data.featureBranch,
        data.targetBranch
      );

      if (this.serviceStore.createdBranchName !== data.featureBranch) {
        window.showInformationMessage(
          `Branch name '${data.featureBranch}' already exists. Using '${this.serviceStore.createdBranchName}' instead.`
        );
      }

      await this.git.checkout(this.serviceStore.createdBranchName);
      this.loggingService.info(
        `Created and switched to feature branch: ${this.serviceStore.createdBranchName}`
      );

      // create commits generator
      this.commitGenerator = new CommitsGenerator(this.git, data.selectedCommits)[
        Symbol.asyncIterator
      ]();

      // start cherry picking
      this.cherryPickNext();
    } catch (error) {}

    return;

    let createdBranchName;
    let originalBranch;
    let stashMessage;
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
            this.loggingService.info(
              `Created and switched to feature branch: ${createdBranchName}`
            );

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
          // this.loggingService.info(`Cleaning up created branch: ${createdBranchName}`);
          // // Switch back to original branch first
          // if (originalBranch) {
          //   await this.git.checkout(originalBranch);
          // }
          // await this.git.deleteLocalBranch(createdBranchName);
        } catch (cleanupError) {
          this.loggingService.warn(
            `Failed to cleanup branch ${createdBranchName}: ${cleanupError}`
          );
        }
      }

      // window.showErrorMessage(
      //   `Failed to clone PR: ${error instanceof Error ? error.message : error}`
      // );
    } finally {
      // Step 10: Switch back to original branch
      if (originalBranch) {
        try {
          // await this.git.checkout(originalBranch);
          // this.loggingService.info(`Switched back to original branch: ${originalBranch}`);
        } catch (checkoutError) {
          this.loggingService.warn(`Failed to switch back to original branch: ${checkoutError}`);
        }
      }

      // Step 11: Restore stashed changes if they were created
      if (stashMessage) {
        try {
          // const isStashExists = await this.git.isStashWithMessageExists(stashMessage);
          // if (isStashExists) {
          //   this.loggingService.info(`Restoring stashed changes: ${stashMessage}`);
          //   await this.git.popStash(stashMessage);
          //   this.loggingService.info('Stashed changes restored successfully');
          // }
        } catch (error) {
          this.loggingService.warn(`Failed to restore stashed changes: ${error}`);
          window.showWarningMessage(
            'Failed to restore your previously stashed changes. Please check your git stash list manually.'
          );
        }
      }
    }
  }

  abortClonePR() {
    this.cancelProgress?.();
    this.cleanUp(true);
  }

  private async cherryPickCommitsInPlace(
    commitShas: string[],
    token: CancellationToken
  ): Promise<void> {
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
      const errorMessage = `: Cherry-pick conflicts detected. Please resolve conflicts manually in VS Code and continue the cherry-pick process using VS Code's built-in Git capabilities.`;

      this.loggingService.error(`Cherry-pick failed with conflicts: ${error}`);

      const continueAction = 'OK';
      await window.showWarningMessage(errorMessage, { modal: true }, continueAction);

      // The cherry-pick process is now in the user's hands
      // They need to resolve conflicts manually and continue
      throw new Error('Cherry-pick conflicts require manual resolution');
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
    await setContextShowPRClone(false);
    await setContextShowPRCommits(false);
  }
}
