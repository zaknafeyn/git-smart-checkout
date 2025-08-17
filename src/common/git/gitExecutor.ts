import { ExecException, ExecSyncOptions } from 'child_process';

import { LoggingService } from '../../logging/loggingService';
import { execCommand } from '../../utils/execCommand';
import { IGitRef, TUpstreamTrack } from './types';

export class GitExecutor {
  #repositoryPath;
  #logService;

  constructor(repositoryPath: string, logService: LoggingService) {
    this.#repositoryPath = repositoryPath;
    this.#logService = logService;
  }

  // #region private

  async #execGitCommandWithOptions(command: string, options?: ExecSyncOptions) {
    return execCommand(command, this.#logService, { cwd: this.#repositoryPath, ...options });
  }

  async #execGitCommand(command: string) {
    return await this.#execGitCommandWithOptions(command, {});
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
      await this.#execGitCommand(`git show-ref --verify --quiet refs/heads/${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  async #checkRemoteBranchExists(branchName: string): Promise<boolean> {
    try {
      await this.#execGitCommand(`git show-ref --verify --quiet refs/remotes/origin/${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  // #endregion private

  async fetchAllRemoteBranchesAndTags() {
    const commandFetchAllBranches = 'git fetch --all';
    // fetch all tags and overwrite local tags with remote if remote one has changed
    const commandFetchAllTags = 'git fetch --tags --force';

    await this.#execGitCommand(commandFetchAllBranches);
    await this.#execGitCommand(commandFetchAllTags);
  }

  async fetchSpecificBranch(branchName: string, remoteName = 'origin') {
    const command = `git fetch ${remoteName} ${branchName}:refs/remotes/${remoteName}/${branchName}`;

    await this.#execGitCommand(command);
  }

  async pullCurrentBranch() {
    const command = 'git pull';

    await this.#execGitCommand(command);
  }

  async createUniqueFeatureBranch(baseBranchName: string, sourceBranch: string): Promise<string> {
    let branchName = baseBranchName;
    let suffix = 1;

    // Check if branch already exists
    while (await this.branchExist(branchName)) {
      branchName = `${baseBranchName}_${suffix}`;
      suffix++;
    }

    await this.createBranch(branchName, sourceBranch);
    return branchName;
  }

  async checkout(branchName: string) {
    // Check if it's a remote branch that doesn't have a local counterpart
    const localBranchExists = await this.#checkLocalBranchExists(branchName);
    const remoteBranchExists = await this.#checkRemoteBranchExists(branchName);

    if (!localBranchExists && remoteBranchExists) {
      // Create a local tracked branch for the remote branch
      const command = `git checkout -b ${branchName} origin/${branchName}`;
      const { stdout } = await this.#execGitCommand(command);
      return stdout;
    } else {
      // Regular checkout for existing local branches
      const command = `git checkout ${branchName}`;
      const { stdout } = await this.#execGitCommand(command);
      return stdout;
    }
  }

  /**
   * @deprecated consider using checkout with string parameter
   */
  async checkoutBranch(branch: IGitRef) {
    const command = `git checkout ${branch.name} ${branch.remote ? `${branch.fullName}` : ''}`;

    const { stdout } = await this.#execGitCommand(command);

    return stdout;
  }

  async createBranch(branchName: string, sourceBranch: string | undefined = undefined) {
    const command = `git checkout -b ${branchName} ${sourceBranch ? sourceBranch : ''}`;

    const { stdout } = await this.#execGitCommand(command);

    return stdout;
  }

  async createStash(stashName: string, include: 'all' | 'untracked' | 'none' = 'untracked') {
    const commandArr = [
      `git stash push -m "${stashName}"`,
      ...(include === 'all' ? ['-a'] : []),
      ...(include === 'untracked' ? ['-u'] : []),
    ];

    const command = commandArr.join(' ');

    const { stdout } = await this.#execGitCommand(command);

    if (stdout.includes('No local changes to save')) {
      throw new Error('No local changes to save');
    }
  }

  async resetLocalChanges() {
    // Discard all local changes
    const command = 'git restore .';

    await this.#execGitCommand(command);
  }

  async getAllRefListExtended(fetchRemotes = false): Promise<IGitRef[]> {
    if (fetchRemotes) {
      await this.fetchAllRemoteBranchesAndTags();
    }

    const SEPARATOR = '|';
    const command = `git for-each-ref --sort -committerdate --format="%(refname)${SEPARATOR}%(objectname:short)${SEPARATOR}%(*objectname:short)${SEPARATOR}%(committerdate:unix)${SEPARATOR}%(*committerdate:unix)${SEPARATOR}%(subject)${SEPARATOR}%(*subject)${SEPARATOR}%(upstream:track)${SEPARATOR}%(authorname)${SEPARATOR}%(*authorname)" refs/heads refs/remotes refs/tags`;
    const { stdout: branchesOutput } = await this.#execGitCommand(command);

    // Split the output into lines and remove leading/trailing whitespace
    const branches = branchesOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        /**
         * parse remote branches like:
         * refs/heads/feature/add-extension-and-refactoring|8aaf984|Minor fixes|unixTimeStamp|1 2
         * refs/remotes/origin/feature/add-extension-and-refactoring|8aaf984|Minor fixes
         * refs/tags/v1.2.3|8aaf984|Minor fixes
         * */

        const [
          ref,
          hash,
          dereferredHash,
          committerDate,
          dereferredCommitterDate,
          comment,
          dereferredComment,
          upstreamTrack,
          authorName,
          dereferredAuthorName,
        ] = line.split(SEPARATOR);

        const parsedUpstreamTrack = this.#parseTrackData(upstreamTrack);

        const branchArr = ref.split('/');
        const [_, refType, ...other] = branchArr;

        const common: Partial<IGitRef> = {
          authorName: authorName ? authorName : dereferredAuthorName,
          hash: dereferredHash ? dereferredHash : hash,
          comment: dereferredComment ? dereferredComment : comment,
          fullName: other.join('/'),
          committerDate: dereferredCommitterDate ? dereferredCommitterDate : committerDate,
          upstreamTrack,
          parsedUpstreamTrack,
        };

        if (refType.toLowerCase() === 'remotes') {
          const [remote, ...rest] = other;

          return {
            remote,
            name: rest.join('/'),
            ...common,
          } as IGitRef;
        }

        return {
          name: other.join('/'),
          isTag: refType.toLowerCase() === 'tags',
          ...common,
        } as IGitRef;
      });

    return branches;
  }

  async getCurrentBranch() {
    const command = 'git branch --show-current';

    const { stdout } = await this.#execGitCommand(command);

    return stdout.trim();
  }

  async pullFromRemoteBranch() {
    const command = 'git pull';

    await this.#execGitCommand(command);
  }

  async popStash(stashName: string, apply = false) {
    const command = 'git --no-pager stash list --format="%gs"';
    // Get the list of stashes
    const { stdout: stdoutGitStashList } = await this.#execGitCommand(command);

    // Split the output into lines
    const stashesStrings = stdoutGitStashList.split('\n').filter((line) => line.trim() !== '');

    // Create a mapping of index to stash message
    const stashes = stashesStrings.map((message, index) => {
      // Remove the "On <branch>: " prefix
      const formattedMessage = message.split(': ')[1];
      return {
        index,
        message: formattedMessage,
      };
    });

    // Find the index of the stash we want to pop
    const stashIndex = stashes.findIndex((stash) => stash.message === stashName);

    // If the stash was not found, throw an error
    if (stashIndex === -1) {
      throw new Error(`No stash found`);
    }

    const popStashCommand = `git stash ${apply ? 'apply' : 'pop'} stash@{${stashIndex}}`;

    // Pop the stash
    await this.#execGitCommand(popStashCommand);
  }

  async isWorkdirHasChanges() {
    const command = 'git status --porcelain';

    const { stdout } = await this.#execGitCommand(command);
    const uncommittedChanges = stdout.trim();

    return uncommittedChanges.length !== 0;
  }

  async isStashWithMessageExists(message: string) {
    const command = 'git stash list --format="%gs"';

    try {
      const { stdout } = await this.#execGitCommand(command);
      const stashesStrings = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '');
      const stashMessages = stashesStrings.map((msgWithPrefix) => {
        const parts = msgWithPrefix.split(': ');
        return parts.length > 1 ? parts.slice(1).join(': ') : msgWithPrefix;
      });

      return stashMessages.some((msg) => msg === message);
    } catch {
      return false;
    }
  }

  async getRemoteUrl(remoteName = 'origin'): Promise<string> {
    const { stdout } = await this.#execGitCommand(`git remote get-url ${remoteName}`);
    return stdout.trim();
  }

  async getConflictedFiles() {
    const command = 'git diff --name-only --diff-filter=U';

    const { stdout } = await this.#execGitCommand(command);
    const conflictedFiles = stdout.trim().split('\n').filter(Boolean);
    return conflictedFiles;
  }

  async cherryPick(
    commitSha: string | string[],
    parseError = false
  ): Promise<{ conflicts: boolean } | void> {
    const commits = Array.isArray(commitSha) ? commitSha.join(' ') : commitSha;
    try {
      await this.#execGitCommand(`git cherry-pick ${commits}`);
    } catch (error) {
      if (!parseError) {
        throw error;
      }

      const e = error as ExecException & { stdout: string; stderr: string };
      // exit code meaning for cherry-pick command: (0 = success, 1 = conflict, other = fatal error).

      if (e.code === 1) {
        return {
          conflicts: true,
        };
      }
    }
  }

  async cherryPickContinue(): Promise<void> {
    await this.#execGitCommand('git cherry-pick --continue');
  }

  async cherryPickAbort(): Promise<void> {
    await this.#execGitCommand('git cherry-pick --abort');
  }

  async cherryPickSkip(): Promise<void> {
    await this.#execGitCommand('git cherry-pick --skip');
  }

  async isCherryPickInProgress(): Promise<boolean> {
    try {
      const { stdout } = await this.#execGitCommand('git status --porcelain=v1');
      return stdout.includes('You are currently cherry-picking');
    } catch {
      return false;
    }
  }

  async deleteLocalBranch(branchName: string) {
    const { stdout } = await this.#execGitCommand(`git branch -D ${branchName}`);

    return stdout.trim();
  }

  async worktreeList(muteError = false) {
    const command = 'git worktree list --porcelain';

    try {
      const { stdout } = await this.#execGitCommand(command);

      return stdout
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.replace('worktree ', '').trim());
    } catch (error) {
      if (muteError) {
        return [];
      }

      throw new Error(`Failed to get worktree list: ${error}`);
    }
  }

  async worktreeRemove(workTreePath: string, force = true) {
    const command = `git worktree remove "${workTreePath}" ${force ? '--force' : ''}`;
    const { stdout } = await this.#execGitCommand(command);

    return stdout;
  }

  async worktreeAdd(workTreePath: string, targetBranch: string) {
    const command = `git worktree add "${workTreePath}" ${targetBranch} --force`;

    const { stdout } = await this.#execGitCommand(command);

    return stdout;
  }

  async branchExist(branchName: string) {
    const command = `git show-ref --verify --quiet refs/heads/${branchName}`;
    const commandRemote = `git show-ref --verify --quiet refs/remotes/origin/${branchName}`;

    try {
      await this.#execGitCommand(command);
      return true;
    } catch (error) {
      //verify remote branch
      try {
        await this.#execGitCommand(commandRemote);
        return true;
      } catch {
        return false;
      }
    }
  }

  async pushBranchToGitHub(branchName: string): Promise<void> {
    const command = `git push -u origin ${branchName}`;

    await this.#execGitCommand(command);
  }

  async getCommitTimestamp(sha: string) {
    const command = `git show --format="%ct" --no-patch ${sha}`;

    try {
      const { stdout } = await this.#execGitCommand(command);
      const timestamp = parseInt(stdout.trim().replace(/"/g, ''));
      return { sha, timestamp };
    } catch (error) {
      return { sha, timestamp: 0 };
    }
  }
}
