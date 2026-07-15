import { commands, env, Memento, Progress, Uri, window } from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import { GitHubClient } from '../common/api/ghClient';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { GitHubPR } from '../types/dataTypes';
import { getStashMessage } from '../commands/utils/getStashMessage';
import { PrCloneData } from './prCloneService';
import { createWithProcess } from '../utils/createWithProcess';
import { CommitGeneratorItem, CommitsGenerator } from '../utils/commitsGenerator';
import {
  setContextIsCherryPickConflict,
  setContextIsCloning,
  setContextShowPRClone,
  setContextShowPRCommits,
} from '../utils/setContext';
import { PrCloneServiceBase } from './prCloneServiceBase';
import { AnalyticsEvent, capture, captureException } from '../analytics/analytics';
import { PrCloneReportedError } from './prCloneError';

interface IServiceStore {
  originalBranch?: string;
  createdBranchName?: string;
  stashMessage?: string;
  originalPrData?: PrCloneData;
}

/** Key used to persist an in-progress in-place clone operation so it can survive a window reload/crash. */
export const PR_CLONE_IN_PLACE_STATE_KEY = 'gitSmartCheckout.prCloneInPlaceOperation';

/**
 * Snapshot of an in-place PR clone operation, persisted to `workspaceState` so it can be
 * recovered on the next activation if VS Code closes/crashes while paused on a cherry-pick
 * conflict (see issue: "No recovery path if VS Code closes mid in-place clone").
 */
export interface IPersistedCloneOperation {
  repoPath: string;
  originalBranch: string;
  createdBranchName: string;
  stashMessage?: string;
  /** Shas that still need to land, including the one that may currently be mid-conflict. */
  remainingShas: string[];
  prNumber: number;
  ts: number;
  targetBranch: string;
  description: string;
  isDraft: boolean;
  prData: GitHubPR;
}

export class PrCloneInPlaceService extends PrCloneServiceBase {
  private updateProgress?: Progress<{ message?: string; increment?: number }>;
  private commitGenerator: AsyncGenerator<CommitGeneratorItem, void, unknown> | undefined;
  private serviceStore: IServiceStore = {};
  private remainingShas: string[] = [];

  constructor(
    git: GitExecutor,
    ghClient: GitHubClient,
    loggingService: LoggingService,
    private workspaceState?: Memento,
    configurationManager?: ConfigurationManager
  ) {
    super(git, ghClient, loggingService, configurationManager);
  }

  async cherryPickNext(isContinue = false) {
    if (!this.commitGenerator) {
      await window.showInformationMessage('No PR clone in progress.');

      return;
    }

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
      try {
        this.updateProgress?.report({ message: 'All commits were applied' });

        // push branch and proceed to PR creation
        const pushRemote = await this.resolvePrCloneRemote({
          branch: this.serviceStore.createdBranchName,
          purpose: 'push',
          githubRepo:
            this.serviceStore.originalPrData?.prData.head?.repo?.full_name ??
            this.serviceStore.originalPrData?.prData.base?.repo?.full_name,
        });
        await this.git.pushBranchToGitHub(this.serviceStore.createdBranchName!, pushRemote);

        const { targetBranch, prData, description, isDraft } = this.serviceStore.originalPrData || {
          targetBranch: '',
          prData: undefined,
          description: '',
          isDraft: true,
        };

        const newPr = await this.createGitHubPR(
          prData!,
          this.serviceStore.createdBranchName!,
          targetBranch!,
          description!,
          isDraft!
        );

        capture(AnalyticsEvent.PrCloneCompleted, {
          is_draft: isDraft,
          commit_count: this.serviceStore.originalPrData?.selectedCommits.length,
        });

        const openAction = await window.showInformationMessage(
          `PR #${newPr.number} created successfully!`,
          'Open'
        );

        if (openAction === 'Open') {
          await env.openExternal(Uri.parse(newPr.html_url));
        }

        this.finishProgress?.();
        await this.cleanUp();
      } catch (error) {
        await this.recoverFromFailure(error);
        throw new PrCloneReportedError(error);
      }
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
          await setContextIsCherryPickConflict(true);
          this.updateProgress?.report({
            message: `There are conflicts on commit ${nextCommit.value.sha}, (${nextCommit.value.current} of ${nextCommit.value.total})`,
          });
          // switch to source control tab to resolve conflicts
          await commands.executeCommand('workbench.view.scm');
          return;
        } else {
          // Commit landed successfully; shrink the persisted remaining-commits list so a
          // reload/crash recovery resumes from the right place instead of re-applying it.
          this.remainingShas = this.remainingShas.filter((sha) => sha !== nextCommit.value.sha);
          this.persistState();
          await this.cherryPickNext();
        }
      } catch (error) {
        if (error instanceof PrCloneReportedError) {
          throw error;
        }

        this.loggingService.error(`Cannot cherry-pick a commit '${nextCommit.value}': ${error}`);

        await this.recoverFromFailure(error);
        throw new PrCloneReportedError(error);
      }
    }
  }

  async cleanUp(isAborting = false): Promise<void> {
    this.updateProgress?.report({ message: 'Clean up' });

    try {
      for (const action of this.cleanUpActionBegin) {
        await action();
      }

      await setContextIsCloning(false);
      await setContextIsCherryPickConflict(false);

      // A service for an inactive clone mode can be disposed without ever
      // touching the repository. Do not reset that repository during cleanup.
      if (!this.serviceStore.originalBranch) {
        return;
      }

      // Check if there's an active cherry-pick operation and abort it
      try {
        if (await this.git.isCherryPickInProgress()) {
          await this.git.cherryPickAbort();
        }
      } catch (error) {
        this.loggingService.warn(`Failed to abort cherry-pick: ${error}`);
      }

      if (this.serviceStore.createdBranchName) {
        try {
          await this.git.reset(true);
        } catch (error) {
          this.loggingService.warn(`Failed to reset working directory: ${error}`);
        }
      }

      let restoredOriginalBranch = false;
      try {
        await this.git.checkout(this.serviceStore.originalBranch);
        restoredOriginalBranch = true;
      } catch (error) {
        this.loggingService.warn(
          `Failed to restore original branch '${this.serviceStore.originalBranch}': ${error}`
        );
      }

      if (restoredOriginalBranch && this.serviceStore.stashMessage) {
        try {
          await this.git.popStash(this.serviceStore.stashMessage);
        } catch (error) {
          this.loggingService.warn(
            `Failed to restore stashed changes '${this.serviceStore.stashMessage}': ${error}`
          );
        }
      }

      if (!isAborting) {
        await this.hideActivityBar();
        return;
      }

      if (!this.serviceStore.createdBranchName || !restoredOriginalBranch) {
        return;
      }

      capture(AnalyticsEvent.PrCloneAborted);
      try {
        await this.git.deleteLocalBranch(this.serviceStore.createdBranchName);
      } catch (error) {
        this.loggingService.warn(
          `Failed to delete clone branch '${this.serviceStore.createdBranchName}': ${error}`
        );
      }
    } finally {
      try {
        for (const action of this.cleanUpActionEnd) {
          await action();
        }
      } finally {
        this.resetOperationState();
      }
    }
  }

  async clonePR(data: PrCloneData): Promise<void> {
    this.loggingService.debug('Start cloning PR using in-place cherry-pick...');

    this.resetOperationState();
    this.serviceStore.originalPrData = data;

    const { finishProgress, cancelProgress, updateProgress } = createWithProcess(
      `Cloning PR #${data.prData.number} (In-Place)`,
      this.cleanUp.bind(this)
    );

    this.finishProgress = finishProgress;
    this.cancelProgress = cancelProgress;
    this.updateProgress = updateProgress;

    try {
      capture(AnalyticsEvent.PrCloneStarted, { commit_count: data.selectedCommits.length, is_draft: data.isDraft });

      // Step 1: Store original branch and stash changes if needed
      this.serviceStore.originalBranch = await this.git.getCurrentBranch();
      updateProgress.report({ message: 'Checking for uncommitted changes...' });

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

      // Step 2: Fetch the PR's commits (works for same-repo and fork PRs alike)
      updateProgress.report({ message: `Fetching PR #${data.prData.number} commits...` });
      try {
        const fetchRemote = await this.resolvePrCloneRemote({
          branch: data.targetBranch,
          purpose: 'fetch',
          githubRepo: data.prData.base?.repo?.full_name,
        });
        await this.git.fetchPullRequestHead(data.prData.number, fetchRemote);
        this.loggingService.info(`Fetched PR #${data.prData.number} commits`);
      } catch (fetchError) {
        throw new Error(`Could not fetch the PR's commits from GitHub: ${fetchError}`);
      }

      // Step 3: Switch to base branch and pull latest changes
      updateProgress.report({ message: `Switching to base branch: ${data.targetBranch}...` });
      await this.git.checkout(data.targetBranch);

      updateProgress.report({ message: 'Pulling latest changes...' });
      try {
        await this.git.pullCurrentBranch();
        this.loggingService.info(`Pulled latest changes for ${data.targetBranch}`);
      } catch (pullError) {
        this.loggingService.warn(`Failed to pull latest changes: ${pullError}`);
      }

      // Step 4: Create unique feature branch
      updateProgress.report({ message: 'Creating feature branch...' });
      this.serviceStore.createdBranchName = await this.git.createUniqueFeatureBranch(
        data.featureBranch,
        data.targetBranch
      );

      if (this.serviceStore.createdBranchName !== data.featureBranch) {
        await window.showInformationMessage(
          `Branch name '${data.featureBranch}' already exists. Using '${this.serviceStore.createdBranchName}' instead.`
        );
      }

      await this.git.checkout(this.serviceStore.createdBranchName);
      this.loggingService.info(
        `Created and switched to feature branch: ${this.serviceStore.createdBranchName}`
      );

      // Preflight: ensure every selected commit is actually available locally
      for (const sha of data.selectedCommits) {
        if (!(await this.git.commitExists(sha))) {
          throw new Error(`Commit ${sha} is not available locally`);
        }
      }

      // create commits generator
      this.commitGenerator = new CommitsGenerator(data.selectedCommits)[Symbol.asyncIterator]();
      this.remainingShas = [...data.selectedCommits];
      this.persistState();

      // start cherry picking
      await this.cherryPickNext();
    } catch (error) {
      if (error instanceof PrCloneReportedError) {
        throw error;
      }

      await this.recoverFromFailure(error);
      throw new PrCloneReportedError(error);
    }
  }

  dispose() {
    this.cleanUpActionEnd = [];
    this.cleanUpActionBegin = [];
    this.resetOperationState();
  }

  protected async showCloneError(error: unknown): Promise<void> {
    await window.showErrorMessage(
      `Failed to clone PR: ${error instanceof Error ? error.message : error}`
    );
  }

  private async recoverFromFailure(error: unknown): Promise<void> {
    this.loggingService.error(`Failed to clone PR: ${error}`);
    captureException(error);

    // Error recovery completes the notification. The current createWithProcess
    // cancel handle rejects its internal promise, so invoking it here would
    // create an unhandled rejection until item 8 changes that API.
    this.finishProgress?.();
    await this.cleanUp(true);
    await this.showCloneError(error);
  }

  private resetOperationState(): void {
    this.serviceStore = {};
    this.commitGenerator = undefined;
    this.remainingShas = [];
    this.updateProgress = undefined;
    this.finishProgress = undefined;
    this.cancelProgress = undefined;
    this.clearPersistedState();
  }

  /**
   * Persist the current operation (start of clone, and after every commit successfully lands)
   * so it can be recovered on the next activation if the window closes/crashes mid-operation.
   */
  private persistState(): void {
    if (!this.workspaceState) {
      return;
    }

    const { originalBranch, createdBranchName, stashMessage, originalPrData } = this.serviceStore;
    if (!originalBranch || !createdBranchName || !originalPrData) {
      return;
    }

    const record: IPersistedCloneOperation = {
      repoPath: this.git.repositoryPath,
      originalBranch,
      createdBranchName,
      stashMessage,
      remainingShas: [...this.remainingShas],
      prNumber: originalPrData.prData.number,
      ts: Date.now(),
      targetBranch: originalPrData.targetBranch,
      description: originalPrData.description,
      isDraft: originalPrData.isDraft,
      prData: originalPrData.prData,
    };

    void this.workspaceState.update(PR_CLONE_IN_PLACE_STATE_KEY, record);
  }

  private clearPersistedState(): void {
    if (!this.workspaceState) {
      return;
    }

    void this.workspaceState.update(PR_CLONE_IN_PLACE_STATE_KEY, undefined);
  }

  private restoreServiceStoreFromRecord(record: IPersistedCloneOperation): void {
    this.serviceStore = {
      originalBranch: record.originalBranch,
      createdBranchName: record.createdBranchName,
      stashMessage: record.stashMessage,
      originalPrData: {
        prData: record.prData,
        targetBranch: record.targetBranch,
        featureBranch: record.createdBranchName,
        description: record.description,
        selectedCommits: record.remainingShas,
        isDraft: record.isDraft,
      },
    };
    this.remainingShas = [...record.remainingShas];
  }

  /**
   * Rebuild in-memory state from a persisted record (found on activation) and re-set the
   * contexts so the UI picks back up at the paused conflict, without touching the repository.
   */
  async resumeOperation(record: IPersistedCloneOperation): Promise<void> {
    this.restoreServiceStoreFromRecord(record);

    this.commitGenerator = new CommitsGenerator(record.remainingShas)[Symbol.asyncIterator]();
    if (record.remainingShas.length > 0) {
      // The head of remainingShas is the commit that was mid-cherry-pick (still conflicted in
      // git) when the window closed. Advance the generator past it so that the next
      // "Conflicts resolved" click resumes with the following commit, matching the position
      // cherryPickNext would have been in right before the interruption.
      await this.commitGenerator.next();
    }

    this.persistState();

    await setContextIsCloning(true);
    await setContextIsCherryPickConflict(true);
    await setContextShowPRClone(true);
    await setContextShowPRCommits(true);
  }

  /**
   * Rebuild just enough in-memory state from a persisted record to run the existing
   * abort/cleanup path, restoring the pre-clone repository state (original branch + stash).
   */
  async abortFromPersistedState(record: IPersistedCloneOperation): Promise<void> {
    this.restoreServiceStoreFromRecord(record);
    await this.abortClonePR();
  }

  private async createGitHubPR(
    originalPr: GitHubPR,
    featureBranch: string,
    targetBranch: string,
    description: string,
    isDraft: boolean
  ): Promise<GitHubPR> {
    const prBody = description;

    // Extract labels and assignees from original PR
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
}
