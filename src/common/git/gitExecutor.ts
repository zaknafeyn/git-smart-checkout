import { ExecSyncOptions } from 'child_process';
import { execCommand } from '../../utils/execCommand';
import { IGitRef, TUpstreamTrack } from './types';

export class GitExecutor {
  #repositoryPath;
  #verbose;

  constructor(repositoryPath: string, verbose = false) {
    this.#repositoryPath = repositoryPath;
    this.#verbose = verbose;
  }

  // #region private

  async #execGitCommandWithOptions(
    command: string,
    options?: ExecSyncOptions,
    verbose = false,
    logger: (args: unknown) => void = console.log
  ) {
    return execCommand(
      command,
      { cwd: this.#repositoryPath, ...options },
      verbose || this.#verbose,
      logger
    );
  }

  async #execGitCommand(
    command: string,
    verbose = false,
    logger: (args: unknown) => void = console.log
  ) {
    return await this.#execGitCommandWithOptions(command, {}, verbose, logger);
  }

  /*
   * convert following strings:
   * [ahead 3, behind 2]
   * [ahead 3]
   * [behind 2]
   * [gone]
   **/

  #parseTrackData(upstreamTrack: string): TUpstreamTrack {
    if (!upstreamTrack || upstreamTrack === '[gone]') return;

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

  // #endregion private

  async fetchAllRemoteBranchesAndTags() {
    const command = 'git fetch --all --tags --prune';

    await this.#execGitCommand(command);
  }

  async checkout(branchName: string) {
    const command = `git checkout ${branchName}`;

    const { stdout } = await this.#execGitCommand(command);

    return stdout;
  }

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

  async createStash(stashName: string, includeUntracked: boolean) {
    const command = `git stash push -m "${stashName}" ${includeUntracked ? '-u' : ''}`;

    const { stdout } = await this.#execGitCommand(command);

    if (stdout.includes('No local changes to save')) {
      throw new Error('No local changes to save');
    }
  }

  async getAllRefListExtended(fetchRemotes = true): Promise<IGitRef[]> {
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
    if (stashIndex == -1) {
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
    const command = `git stash list | grep ${message}`;

    try {
      const { stdout } = await this.#execGitCommand(command);

      const stashByMessage = stdout.trim();

      return stashByMessage.length !== 0;
    } catch {
      return false;
    }
  }
}
