import { ExecException, ExecSyncOptions } from 'child_process';

import { LoggingService } from '../../logging/loggingService';
import { execCommand } from '../../utils/execCommand';
import { VscodeGitProvider } from './vscodeGitProvider';
import { IGitRef, TUpstreamTrack } from './types';

export class GitExecutor {
  #repositoryPath;
  #logService;
  #vscodeGitProvider: VscodeGitProvider | undefined;

  constructor(repositoryPath: string, logService: LoggingService, vscodeGitProvider?: VscodeGitProvider) {
    this.#repositoryPath = repositoryPath;
    this.#logService = logService;
    this.#vscodeGitProvider = vscodeGitProvider;
  }

  get repositoryPath(): string {
    return this.#repositoryPath;
  }

  async getAllRefListFast(): Promise<IGitRef[] | undefined> {
    return this.#vscodeGitProvider?.getRefsForRepo(this.#repositoryPath);
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
    const command = `git show-ref --verify --quiet refs/heads/${branchName}`;

    try {
      await this.#execGitCommand(command);

      return true;
    } catch {
      return false;
    }
  }

  async #checkRemoteBranchExists(
    branchName: string,
    includeRemoteName = false,
    remoteName = 'origin'
  ): Promise<boolean> {
    const command = `git show-ref --verify --quiet refs/remotes${includeRemoteName ? `/${remoteName}` : ''}/${branchName}`;

    try {
      await this.#execGitCommand(command);
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

  async checkout(branchName: string, remoteName = 'origin') {
    // Check if it's a remote branch that doesn't have a local counterpart
    const localBranchExists = await this.#checkLocalBranchExists(branchName);
    const remoteBranchExists = await this.#checkRemoteBranchExists(branchName);

    if (!localBranchExists && remoteBranchExists) {
      // Create a local tracked branch for the remote branch
      const command = `git checkout -b ${branchName} ${remoteName}/${branchName}`;
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

  async createBranch(
    branchName: string,
    sourceBranch: string | undefined = undefined
  ): Promise<IGitRef> {
    const command = `git checkout -b ${branchName} ${sourceBranch ? sourceBranch : ''}`;

    await this.#execGitCommand(command);

    // Get detailed information about the newly created branch
    const SEPARATOR = '|';
    const branchInfoCommand = `git for-each-ref --format="%(refname)${SEPARATOR}%(objectname:short)${SEPARATOR}%(committerdate:unix)${SEPARATOR}%(subject)${SEPARATOR}%(authorname)" refs/heads/${branchName}`;
    const { stdout: branchInfo } = await this.#execGitCommand(branchInfoCommand);

    const [, hash, committerDate, comment, authorName] = branchInfo.trim().split(SEPARATOR);

    return {
      name: branchName,
      fullName: branchName,
      hash,
      comment,
      authorName,
      committerDate,
    };
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

  async reset(hard = false) {
    const command = `git reset ${hard ? '--hard' : ''}`.trimEnd();

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

  // Predicts stash-apply conflicts before any destructive operations by materializing
  // the working tree as a temporary commit via `git stash create` (non-destructive —
  // no entry is pushed to refs/stash) and then running `git merge-tree` to simulate
  // a 3-way merge of that commit onto targetRef. Requires Git >= 2.38.
  // `merge-tree` exits non-zero and writes conflicting paths to stdout when conflicts
  // are found, so we capture stdout from both the success and error paths.
  async getStashConflictPreview(targetRef: string): Promise<string[]> {
    const { stdout: stashSha } = await this.#execGitCommand('git stash create');
    const sha = stashSha.trim();
    if (!sha) { 
      return [];
    }

    const command = `git merge-tree --write-tree --name-only --no-messages ${targetRef} ${sha}`;
    try {
      await this.#execGitCommand(command);
      return []; // exit 0 = clean merge, no conflicts
    } catch (e: any) {
      // exit 1 = conflicts; stdout is "<tree-oid>\nfile1\nfile2\n…"
      const out: string = e?.stdout ?? '';
      const lines = out.split('\n').map((l: string) => l.trim()).filter(Boolean);
      return lines.slice(1); // skip the tree OID on the first line
    }
  }

  async getConflictedFiles() {
    const command = 'git diff --name-only --diff-filter=U';

    const { stdout } = await this.#execGitCommand(command);
    const conflictedFiles = stdout.trim().split('\n').filter(Boolean);
    return conflictedFiles;
  }

  async hasConflicts(): Promise<boolean> {
    const conflictedFiles = await this.getConflictedFiles();
    return conflictedFiles.length > 0;
  }

  async cherryPick(
    commitSha: string | string[],
    parseError = false,
    emptyCommit: 'skip' | 'allow' = 'skip'
  ): Promise<{ conflicts: boolean } | void> {
    const commits = Array.isArray(commitSha) ? commitSha.join(' ') : commitSha;
    try {
      await this.#execGitCommand(
        `git cherry-pick ${commits} ${emptyCommit === 'allow' ? '--allow-empty' : ''}`
      );
    } catch (error) {
      if (!parseError) {
        throw error;
      }

      const { code, stderr } = error as ExecException & { stdout: string; stderr: string };
      // exit code meaning for cherry-pick command: (0 = success, 1 = conflict, other = fatal error).

      if (code !== 1) {
        return;
      }

      if (emptyCommit === 'skip' && stderr.includes('previous cherry-pick is now empty')) {
        await this.cherryPickSkip();
        return {
          conflicts: false,
        };
      }

      return {
        conflicts: true,
      };
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
    if (await this.#checkLocalBranchExists(branchName)) {
      return true;
    }

    return await this.#checkRemoteBranchExists(branchName);
  }

  async hasUpstreamBranch(branchName: string): Promise<boolean> {
    const command = `git rev-parse --abbrev-ref ${branchName}@{upstream}`;

    try {
      await this.#execGitCommand(command);
      return true;
    } catch {
      return false;
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

  async getRepoInfo(): Promise<{ owner: string; repo: string } | null> {
    try {
      const remoteUrl = await this.getRemoteUrl();
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    } catch (error) {
      this.#logService.error(`Failed to get repo info: ${error}`);
    }
    return null;
  }

  /**
   * Get the previous branch from git reflog
   * This implements the same logic as `git checkout -`
   */
  async getPreviousBranch(numOfLastCommands = 10): Promise<IGitRef | null> {
    try {
      // Get the reflog entries for HEAD
      const command = `git reflog --format="%gs" -n ${numOfLastCommands}`;
      const { stdout } = await this.#execGitCommand(command);
      
      const reflogEntries = stdout.trim().split('\n').filter(line => line.trim() !== '');
      
      // Look for checkout operations to find the previous branch
      for (const entry of reflogEntries) {
        // Match patterns like "checkout: moving from branch1 to branch2"
        const checkoutMatch = entry.match(/checkout: moving from (.+) to (.+)/);
        if (checkoutMatch) {
          const fromBranch = checkoutMatch[1];
          const toBranch = checkoutMatch[2];
          
          // Skip if it's the same as current branch or if it's a detached HEAD
          if (fromBranch !== 'HEAD' && fromBranch !== toBranch && !fromBranch.includes('detached')) {
            // Try to resolve full ref info using existing ref listing
            const allRefs = await this.getAllRefListExtended(false);
            const matchByName = allRefs.find(ref => !ref.isTag && ref.name === fromBranch);
            if (matchByName) {
              return matchByName;
            }

            const matchByFullName = allRefs.find(ref => !ref.isTag && ref.fullName === fromBranch);
            if (matchByFullName) {
              return matchByFullName;
            }

            // As a fallback, return a minimal IGitRef with available data
            return {
              name: fromBranch,
              fullName: fromBranch,
              authorName: '',
            } as IGitRef;
          }
        }
      }
      
      return null;
    } catch (error) {
      this.#logService.error(`Failed to get previous branch: ${error}`);
      return null;
    }
  }
}
