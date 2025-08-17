import { SimpleGit, simpleGit, StatusResult, LogResult, BranchSummary } from 'simple-git';

import { LoggingService } from '../../logging/loggingService';
import { IGitRef, TUpstreamTrack } from './types';

export class GitExecutor {
  #git: SimpleGit;
  #logService: LoggingService;

  constructor(repositoryPath: string, logService: LoggingService) {
    this.#git = simpleGit(repositoryPath);
    this.#logService = logService;
  }

  // #region private

  async #logAndExecute<T>(operation: string, gitOperation: () => Promise<T>): Promise<T> {
    this.#logService.debug(`Executing git operation: ${operation}`);
    try {
      const result = await gitOperation();
      this.#logService.debug(`Git operation completed: ${operation}`);
      return result;
    } catch (error) {
      this.#logService.error(`Git operation failed: ${operation}, error: ${error}`);
      throw error;
    }
  }

  /*
   * convert following strings:
   * [ahead 3, behind 2]
   * [ahead 3]
   * [behind 2]
   * [gone]
   **/

  #parseTrackData(upstreamTrack: string): TUpstreamTrack {
    if (!upstreamTrack || upstreamTrack === '[gone]') {
      return;
    }

    const arr = upstreamTrack.slice(1, -1).split(',');
    if (arr.length === 1) {
      if (arr[0].startsWith('ahead')) {
        arr.push('behind 0');
      } else {
        arr.unshift('ahead 0');
      }
    }

    const [ahead, behind] = arr.map((i) => Number(i.split(' ')[1]));

    return [ahead, behind];
  }

  async #checkLocalBranchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.#git.branch(['--list', branchName]);
      return branches.all.length > 0;
    } catch {
      return false;
    }
  }

  async #checkRemoteBranchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.#git.branch(['-r', '--list', `origin/${branchName}`]);
      return branches.all.length > 0;
    } catch {
      return false;
    }
  }

  // #endregion private

  async fetchAllRemoteBranchesAndTags(): Promise<void> {
    return this.#logAndExecute('fetch all remotes and tags', async () => {
      await this.#git.fetch(['--all']);
      await this.#git.fetch(['--tags', '--force']);
    });
  }

  async fetchSpecificBranch(branchName: string, remoteName = 'origin'): Promise<void> {
    return this.#logAndExecute(`fetch ${remoteName}/${branchName}`, async () => {
      await this.#git.fetch(remoteName, branchName);
    });
  }

  async pullCurrentBranch(): Promise<void> {
    return this.#logAndExecute('pull current branch', async () => {
      await this.#git.pull();
    });
  }

  async createUniqueFeatureBranch(baseBranchName: string, sourceBranch: string): Promise<string> {
    return this.#logAndExecute(`create unique branch from ${baseBranchName}`, async () => {
      let branchName = baseBranchName;
      let suffix = 1;

      // Check if branch already exists
      while (await this.branchExist(branchName)) {
        branchName = `${baseBranchName}_${suffix}`;
        suffix++;
      }

      await this.createBranch(branchName, sourceBranch);
      return branchName;
    });
  }

  async checkout(branchName: string): Promise<string> {
    return this.#logAndExecute(`checkout ${branchName}`, async () => {
      // Check if it's a remote branch that doesn't have a local counterpart
      const localBranchExists = await this.#checkLocalBranchExists(branchName);
      const remoteBranchExists = await this.#checkRemoteBranchExists(branchName);
      
      if (!localBranchExists && remoteBranchExists) {
        // Create a local tracked branch for the remote branch
        await this.#git.checkout(['-b', branchName, `origin/${branchName}`]);
      } else {
        // Regular checkout for existing local branches
        await this.#git.checkout(branchName);
      }
      
      return `Switched to branch '${branchName}'`;
    });
  }

  /**
   * @deprecated consider using checkout with string parameter
   */
  async checkoutBranch(branch: IGitRef): Promise<string> {
    return this.#logAndExecute(`checkout branch ${branch.name}`, async () => {
      if (branch.remote) {
        await this.#git.checkout([branch.name, branch.fullName]);
      } else {
        await this.#git.checkout(branch.name);
      }
      return `Switched to branch '${branch.name}'`;
    });
  }

  async createBranch(branchName: string, sourceBranch?: string): Promise<string> {
    return this.#logAndExecute(`create branch ${branchName}`, async () => {
      if (sourceBranch) {
        await this.#git.checkout(['-b', branchName, sourceBranch]);
      } else {
        await this.#git.checkout(['-b', branchName]);
      }
      return `Created and switched to branch '${branchName}'`;
    });
  }

  async createStash(stashName: string, include: 'all' | 'untracked' | 'none' = 'untracked'): Promise<void> {
    return this.#logAndExecute(`create stash ${stashName}`, async () => {
      const options = ['push', '-m', stashName];
      
      if (include === 'all') {
        options.push('-a');
      } else if (include === 'untracked') {
        options.push('-u');
      }

      const result = await this.#git.stash(options);
      
      if (result && result.includes('No local changes to save')) {
        throw new Error('No local changes to save');
      }
    });
  }

  async resetLocalChanges(): Promise<void> {
    return this.#logAndExecute('reset local changes', async () => {
      await this.#git.raw(['restore', '.']);
    });
  }

  async getAllRefListExtended(fetchRemotes = false): Promise<IGitRef[]> {
    return this.#logAndExecute('get all refs extended', async () => {
      if (fetchRemotes) {
        await this.fetchAllRemoteBranchesAndTags();
      }

      // Get branches
      const branchSummary = await this.#git.branch(['-a', '--sort=-committerdate']);
      const branches: IGitRef[] = [];

      // Process local branches
      for (const [branchName, branchInfo] of Object.entries(branchSummary.branches)) {
        if (branchName.startsWith('remotes/')) {
          // Remote branch
          const remoteParts = branchName.replace('remotes/', '').split('/');
          const [remote, ...nameParts] = remoteParts;
          const name = nameParts.join('/');
          
          branches.push({
            name,
            remote,
            fullName: name,
            hash: branchInfo.commit,
            comment: branchInfo.label || '',
            authorName: '',
            committerDate: '',
            upstreamTrack: '',
            parsedUpstreamTrack: undefined,
          });
        } else {
          // Local branch
          branches.push({
            name: branchName,
            fullName: branchName,
            hash: branchInfo.commit,
            comment: branchInfo.label || '',
            authorName: '',
            committerDate: '',
            upstreamTrack: '',
            parsedUpstreamTrack: undefined,
            isTag: false,
          });
        }
      }

      // Get tags
      const tags = await this.#git.tags();
      for (const tagName of tags.all) {
        const tagInfo = await this.#git.show([tagName, '--format=%H|%s', '--no-patch']);
        const [hash, comment] = tagInfo.split('|');
        
        branches.push({
          name: tagName,
          fullName: tagName,
          hash: hash || '',
          comment: comment || '',
          authorName: '',
          committerDate: '',
          upstreamTrack: '',
          parsedUpstreamTrack: undefined,
          isTag: true,
        });
      }

      return branches.sort((a, b) => (b.committerDate || '').localeCompare(a.committerDate || ''));
    });
  }

  async getCurrentBranch(): Promise<string> {
    return this.#logAndExecute('get current branch', async () => {
      const status = await this.#git.status();
      return status.current || '';
    });
  }

  async pullFromRemoteBranch(): Promise<void> {
    return this.#logAndExecute('pull from remote branch', async () => {
      await this.#git.pull();
    });
  }

  async popStash(stashName: string, apply = false): Promise<void> {
    return this.#logAndExecute(`${apply ? 'apply' : 'pop'} stash ${stashName}`, async () => {
      // Get the list of stashes
      const stashList = await this.#git.stashList();
      
      // Find the index of the stash we want to pop
      const stashIndex = stashList.all.findIndex((stash) => {
        const message = stash.message.split(': ')[1] || stash.message;
        return message === stashName;
      });

      // If the stash was not found, throw an error
      if (stashIndex === -1) {
        throw new Error('No stash found');
      }

      if (apply) {
        await this.#git.stash(['apply', `stash@{${stashIndex}}`]);
      } else {
        await this.#git.stash(['pop', `stash@{${stashIndex}}`]);
      }
    });
  }

  async isWorkdirHasChanges(): Promise<boolean> {
    return this.#logAndExecute('check if workdir has changes', async () => {
      const status = await this.#git.status();
      return status.files.length > 0;
    });
  }

  async isStashWithMessageExists(message: string): Promise<boolean> {
    return this.#logAndExecute(`check if stash exists: ${message}`, async () => {
      try {
        const stashList = await this.#git.stashList();
        return stashList.all.some((stash) => {
          const stashMessage = stash.message.split(': ')[1] || stash.message;
          return stashMessage === message;
        });
      } catch {
        return false;
      }
    });
  }

  async getRemoteUrl(remoteName = 'origin'): Promise<string> {
    return this.#logAndExecute(`get remote URL for ${remoteName}`, async () => {
      const remotes = await this.#git.getRemotes(true);
      const remote = remotes.find(r => r.name === remoteName);
      return remote?.refs?.fetch || '';
    });
  }

  async getConflictedFiles(): Promise<string[]> {
    return this.#logAndExecute('get conflicted files', async () => {
      const status = await this.#git.status();
      return status.conflicted;
    });
  }

  async cherryPick(
    commitSha: string | string[],
    parseError = false
  ): Promise<{ conflicts: boolean } | void> {
    const commits = Array.isArray(commitSha) ? commitSha : [commitSha];
    return this.#logAndExecute(`cherry-pick ${commits.join(', ')}`, async () => {
      try {
        await this.#git.raw(['cherry-pick', ...commits]);
      } catch (error) {
        if (!parseError) {
          throw error;
        }

        // Check if it's a conflict
        const status = await this.#git.status();
        if (status.conflicted.length > 0) {
          return { conflicts: true };
        }
        
        throw error;
      }
    });
  }

  async cherryPickContinue(): Promise<void> {
    return this.#logAndExecute('cherry-pick continue', async () => {
      await this.#git.raw(['cherry-pick', '--continue']);
    });
  }

  async cherryPickAbort(): Promise<void> {
    return this.#logAndExecute('cherry-pick abort', async () => {
      await this.#git.raw(['cherry-pick', '--abort']);
    });
  }

  async cherryPickSkip(): Promise<void> {
    return this.#logAndExecute('cherry-pick skip', async () => {
      await this.#git.raw(['cherry-pick', '--skip']);
    });
  }

  async isCherryPickInProgress(): Promise<boolean> {
    return this.#logAndExecute('check if cherry-pick in progress', async () => {
      try {
        const status = await this.#git.status();
        return status.current?.includes('cherry-picking') || false;
      } catch {
        return false;
      }
    });
  }

  async deleteLocalBranch(branchName: string): Promise<string> {
    return this.#logAndExecute(`delete local branch ${branchName}`, async () => {
      await this.#git.deleteLocalBranch(branchName, true);
      return `Deleted branch ${branchName}`;
    });
  }

  async worktreeList(muteError = false): Promise<string[]> {
    return this.#logAndExecute('list worktrees', async () => {
      try {
        const result = await this.#git.raw(['worktree', 'list', '--porcelain']);
        return result
          .split('\n')
          .filter((line: string) => line.startsWith('worktree '))
          .map((line: string) => line.replace('worktree ', '').trim());
      } catch (error) {
        if (muteError) {
          return [];
        }
        throw new Error(`Failed to get worktree list: ${error}`);
      }
    });
  }

  async worktreeRemove(workTreePath: string, force = true): Promise<string> {
    return this.#logAndExecute(`remove worktree ${workTreePath}`, async () => {
      const options = ['worktree', 'remove', workTreePath];
      if (force) {
        options.push('--force');
      }
      await this.#git.raw(options);
      return `Removed worktree ${workTreePath}`;
    });
  }

  async worktreeAdd(workTreePath: string, targetBranch: string): Promise<string> {
    return this.#logAndExecute(`add worktree ${workTreePath}`, async () => {
      await this.#git.raw(['worktree', 'add', workTreePath, targetBranch, '--force']);
      return `Added worktree ${workTreePath}`;
    });
  }

  async branchExist(branchName: string): Promise<boolean> {
    return this.#logAndExecute(`check if branch exists: ${branchName}`, async () => {
      try {
        // Check local branch
        const localBranches = await this.#git.branch(['--list', branchName]);
        if (localBranches.all.length > 0) {
          return true;
        }

        // Check remote branch
        const remoteBranches = await this.#git.branch(['-r', '--list', `origin/${branchName}`]);
        return remoteBranches.all.length > 0;
      } catch {
        return false;
      }
    });
  }

  async pushBranchToGitHub(branchName: string): Promise<void> {
    return this.#logAndExecute(`push branch ${branchName} to GitHub`, async () => {
      await this.#git.push(['origin', branchName, '--set-upstream']);
    });
  }

  async getCommitTimestamp(sha: string): Promise<{ sha: string; timestamp: number }> {
    return this.#logAndExecute(`get commit timestamp for ${sha}`, async () => {
      try {
        const result = await this.#git.show([sha, '--format=%ct', '--no-patch']);
        const timestamp = parseInt(result.trim());
        return { sha, timestamp };
      } catch (error) {
        return { sha, timestamp: 0 };
      }
    });
  }
}