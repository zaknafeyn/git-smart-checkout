import { ExecSyncOptions } from 'child_process';
import { execCommand } from '../../utils/execCommand';
import { IGitRef, TUpstreamTrack } from './types';
import { LoggingService } from '../../logging/loggingService';

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

  // #endregion private

  async fetchAllRemoteBranchesAndTags() {
    const commandFetchAllBranches = 'git fetch --all';
    // fetch all tags and overwrite local tags with remote if remote one has changed
    const commandFetchAllTags = 'git fetch --tags --force';

    await this.#execGitCommand(commandFetchAllBranches);
    await this.#execGitCommand(commandFetchAllTags);
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
}
