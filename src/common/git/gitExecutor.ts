import { ExecException, ExecFileOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LoggingService } from '../../logging/loggingService';
import { execCommand } from '../../utils/execCommand';
import { VscodeGitProvider } from './vscodeGitProvider';
import { IGitRef, IGitWorktree, TUpstreamTrack } from './types';

export function parseWorktreeListPorcelain(output: string): IGitWorktree[] {
  const worktrees: IGitWorktree[] = [];
  let current: IGitWorktree | undefined;

  const pushCurrent = () => {
    if (current) {
      worktrees.push(current);
      current = undefined;
    }
  };

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      pushCurrent();
      continue;
    }

    const [key, ...valueParts] = line.split(' ');
    const value = valueParts.join(' ');

    if (key === 'worktree') {
      pushCurrent();
      current = { path: value };
      continue;
    }

    if (!current) {
      continue;
    }

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'prunable':
        current.prunable = true;
        break;
    }
  }

  pushCurrent();

  return worktrees;
}

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

  async getRefDetailsFast(ref: IGitRef): Promise<Partial<IGitRef> | undefined> {
    return this.#vscodeGitProvider?.getRefDetails(this.#repositoryPath, ref);
  }

  // #region private

  async #execGitCommandWithOptions(args: string[], options?: ExecFileOptions) {
    return execCommand('git', args, this.#logService, { cwd: this.#repositoryPath, ...options });
  }

  async #execGitCommand(args: string[]) {
    return await this.#execGitCommandWithOptions(args, {});
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
      await this.#execGitCommand(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
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
    const ref = `refs/remotes${includeRemoteName ? `/${remoteName}` : ''}/${branchName}`;
    try {
      await this.#execGitCommand(['show-ref', '--verify', '--quiet', ref]);
      return true;
    } catch {
      return false;
    }
  }

  // #endregion private

  async fetchAllRemoteBranchesAndTags() {
    await this.#execGitCommand(['fetch', '--all']);
    // fetch all tags and overwrite local tags with remote if remote one has changed
    await this.#execGitCommand(['fetch', '--tags', '--force']);
  }

  async fetchSpecificBranch(branchName: string, remoteName = 'origin') {
    await this.#execGitCommand(['fetch', remoteName, `${branchName}:refs/remotes/${remoteName}/${branchName}`]);
  }

  async fetchFromUrl(remoteUrl: string, headRef: string) {
    await this.#execGitCommand(['fetch', remoteUrl, `${headRef}:${headRef}`]);
  }

  async pullCurrentBranch() {
    await this.#execGitCommand(['pull']);
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
      const { stdout } = await this.#execGitCommand(['checkout', '-b', branchName, `${remoteName}/${branchName}`]);
      return stdout;
    } else {
      // Regular checkout for existing local branches
      const { stdout } = await this.#execGitCommand(['checkout', branchName]);
      return stdout;
    }
  }

  /**
   * @deprecated consider using checkout with string parameter
   */
  async checkoutBranch(branch: IGitRef) {
    const args = ['checkout', branch.name, ...(branch.remote ? [branch.fullName] : [])];
    const { stdout } = await this.#execGitCommand(args);
    return stdout;
  }

  async createBranch(
    branchName: string,
    sourceBranch: string | undefined = undefined
  ): Promise<IGitRef> {
    await this.#execGitCommand(['checkout', '-b', branchName, ...(sourceBranch ? [sourceBranch] : [])]);

    // Get detailed information about the newly created branch
    const SEPARATOR = '|';
    const { stdout: branchInfo } = await this.#execGitCommand([
      'for-each-ref',
      `--format=%(refname)${SEPARATOR}%(objectname:short)${SEPARATOR}%(committerdate:unix)${SEPARATOR}%(subject)${SEPARATOR}%(authorname)`,
      `refs/heads/${branchName}`,
    ]);

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
    const args = [
      'stash', 'push', '-m', stashName,
      ...(include === 'all' ? ['-a'] : []),
      ...(include === 'untracked' ? ['-u'] : []),
    ];

    const { stdout } = await this.#execGitCommand(args);

    if (stdout.includes('No local changes to save')) {
      throw new Error('No local changes to save');
    }
  }

  async resetLocalChanges() {
    await this.#execGitCommand(['restore', '.']);
  }

  async reset(hard = false) {
    await this.#execGitCommand(['reset', ...(hard ? ['--hard'] : [])]);
  }

  async discardAllWorktreeChanges() {
    await this.#execGitCommand(['reset', '--hard']);
    await this.#execGitCommand(['clean', '-fd']);
  }

  async getAllRefListExtended(): Promise<IGitRef[]> {
    const SEPARATOR = '|';
    const format = `%(refname)${SEPARATOR}%(objectname:short)${SEPARATOR}%(*objectname:short)${SEPARATOR}%(committerdate:unix)${SEPARATOR}%(*committerdate:unix)${SEPARATOR}%(subject)${SEPARATOR}%(*subject)${SEPARATOR}%(upstream:track)${SEPARATOR}%(authorname)${SEPARATOR}%(*authorname)`;
    const { stdout: branchesOutput } = await this.#execGitCommand([
      'for-each-ref',
      '--sort', '-committerdate',
      `--format=${format}`,
      'refs/heads', 'refs/remotes', 'refs/tags',
    ]);

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
    const { stdout } = await this.#execGitCommand(['branch', '--show-current']);
    return stdout.trim();
  }

  async pullFromRemoteBranch(options: { rebase?: boolean } = {}) {
    await this.#execGitCommand(['pull', ...(options.rebase ? ['--rebase'] : [])]);
  }

  async rebase(target: string): Promise<void> {
    await this.#execGitCommand(['rebase', target]);
  }

  async popStash(stashName: string, apply = false) {
    // Get the list of stashes
    const { stdout: stdoutGitStashList } = await this.#execGitCommand(['--no-pager', 'stash', 'list', '--format=%gs']);

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

    // Pop the stash
    await this.#execGitCommand(['stash', apply ? 'apply' : 'pop', `stash@{${stashIndex}}`]);
  }

  async isWorkdirHasChanges() {
    const { stdout } = await this.#execGitCommand(['status', '--porcelain']);
    return stdout.trim().length !== 0;
  }

  async getStagedChangesPatch(): Promise<string> {
    const { stdout } = await this.#execGitCommand(['diff', '--cached', '--binary']);
    return stdout;
  }

  async getUnstagedChangesPatch(): Promise<string> {
    const { stdout } = await this.#execGitCommand(['diff', '--binary']);
    return stdout;
  }

  async applyPatch(patch: string, options: { staged?: boolean } = {}): Promise<void> {
    if (!patch.trim()) {
      return;
    }

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-patch-'));
    const patchPath = path.join(tempDirectory, 'changes.patch');

    try {
      fs.writeFileSync(patchPath, patch);
      await this.#execGitCommand(['apply', ...(options.staged ? ['--index'] : []), patchPath]);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  async getUntrackedFiles(): Promise<string[]> {
    const { stdout } = await this.#execGitCommand(['ls-files', '--others', '--exclude-standard', '-z']);
    return stdout.split('\0').filter((file) => file.length > 0);
  }

  copyUntrackedFilesTo(targetRepositoryPath: string, files: string[]): void {
    for (const file of files) {
      if (!this.isSafeRelativePath(file)) {
        throw new Error(`Cannot copy unsafe untracked path: ${file}`);
      }

      const sourcePath = path.join(this.#repositoryPath, file);
      const targetPath = path.join(targetRepositoryPath, file);

      if (fs.existsSync(targetPath)) {
        throw new Error(`Cannot copy untracked file because it already exists in target worktree: ${file}`);
      }

      const sourceStat = fs.lstatSync(sourcePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      if (sourceStat.isSymbolicLink()) {
        fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
      } else if (sourceStat.isDirectory()) {
        fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
      } else {
        fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      }
    }
  }

  private isSafeRelativePath(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    return normalized !== '..' && !normalized.startsWith(`..${path.sep}`) && !path.isAbsolute(normalized);
  }

  async isStashWithMessageExists(message: string) {
    try {
      const { stdout } = await this.#execGitCommand(['stash', 'list', '--format=%gs']);
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
    const { stdout } = await this.#execGitCommand(['remote', 'get-url', remoteName]);
    return stdout.trim();
  }

  // Predicts stash-apply conflicts before any destructive operations by materializing
  // the working tree as a temporary commit via `git stash create` (non-destructive —
  // no entry is pushed to refs/stash) and then running `git merge-tree` to simulate
  // a 3-way merge of that commit onto targetRef. Requires Git >= 2.38.
  // `merge-tree` exits non-zero and writes conflicting paths to stdout when conflicts
  // are found, so we capture stdout from both the success and error paths.
  async getStashConflictPreview(targetRef: string): Promise<string[]> {
    const { stdout: stashSha } = await this.#execGitCommand(['stash', 'create']);
    const sha = stashSha.trim();
    if (!sha) {
      return [];
    }

    try {
      await this.#execGitCommand(['merge-tree', '--write-tree', '--name-only', '--no-messages', targetRef, sha]);
      return []; // exit 0 = clean merge, no conflicts
    } catch (e: any) {
      // exit 1 = conflicts; stdout is "<tree-oid>\nfile1\nfile2\n…"
      const out: string = e?.stdout ?? '';
      const lines = out.split('\n').map((l: string) => l.trim()).filter(Boolean);
      return lines.slice(1); // skip the tree OID on the first line
    }
  }

  async getConflictedFiles() {
    const { stdout } = await this.#execGitCommand(['diff', '--name-only', '--diff-filter=U']);
    return stdout.trim().split('\n').filter(Boolean);
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
    const commits = Array.isArray(commitSha) ? commitSha : [commitSha];
    try {
      await this.#execGitCommand([
        'cherry-pick',
        ...commits,
        ...(emptyCommit === 'allow' ? ['--allow-empty'] : []),
      ]);
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
    await this.#execGitCommand(['cherry-pick', '--continue']);
  }

  async cherryPickAbort(): Promise<void> {
    await this.#execGitCommand(['cherry-pick', '--abort']);
  }

  async cherryPickSkip(): Promise<void> {
    await this.#execGitCommand(['cherry-pick', '--skip']);
  }

  async isCherryPickInProgress(): Promise<boolean> {
    try {
      const { stdout } = await this.#execGitCommand(['status', '--porcelain=v1']);
      return stdout.includes('You are currently cherry-picking');
    } catch {
      return false;
    }
  }

  async deleteLocalBranch(branchName: string) {
    const { stdout } = await this.#execGitCommand(['branch', '-D', branchName]);
    return stdout.trim();
  }

  async worktreeList(muteError = false) {
    try {
      const { stdout } = await this.#execGitCommand(['worktree', 'list', '--porcelain']);
      return parseWorktreeListPorcelain(stdout).map((worktree) => worktree.path);
    } catch (error) {
      if (muteError) {
        return [];
      }

      throw new Error(`Failed to get worktree list: ${error}`);
    }
  }

  async worktreeListDetailed(muteError = false): Promise<IGitWorktree[]> {
    try {
      const { stdout } = await this.#execGitCommand(['worktree', 'list', '--porcelain']);
      return parseWorktreeListPorcelain(stdout);
    } catch (error) {
      if (muteError) {
        return [];
      }

      throw new Error(`Failed to get worktree list: ${error}`);
    }
  }

  async worktreeRemove(workTreePath: string, force = true) {
    const { stdout } = await this.#execGitCommand(['worktree', 'remove', workTreePath, ...(force ? ['--force'] : [])]);
    return stdout;
  }

  async worktreeAdd(workTreePath: string, targetBranch: string) {
    const { stdout } = await this.#execGitCommand(['worktree', 'add', workTreePath, targetBranch, '--force']);
    return stdout;
  }

  async worktreeAddLocalBranch(workTreePath: string, targetBranch: string) {
    const { stdout } = await this.#execGitCommand(['worktree', 'add', workTreePath, targetBranch]);
    return stdout;
  }

  async worktreeAddRemoteBranch(workTreePath: string, localBranch: string, remoteRef: string) {
    const { stdout } = await this.#execGitCommand([
      'worktree', 'add', '--track', '-b', localBranch, workTreePath, remoteRef,
    ]);
    return stdout;
  }

  async branchExist(branchName: string) {
    if (await this.#checkLocalBranchExists(branchName)) {
      return true;
    }

    return await this.#checkRemoteBranchExists(branchName);
  }

  async hasUpstreamBranch(branchName: string): Promise<boolean> {
    try {
      await this.#execGitCommand(['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`]);
      return true;
    } catch {
      return false;
    }
  }

  async pushBranchToGitHub(branchName: string): Promise<void> {
    await this.#execGitCommand(['push', '-u', 'origin', branchName]);
  }

  async tagExists(tagName: string): Promise<boolean> {
    try {
      await this.#execGitCommand(['show-ref', '--verify', '--quiet', `refs/tags/${tagName}`]);
      return true;
    } catch {
      return false;
    }
  }

  async createTag(tagName: string): Promise<void> {
    await this.#execGitCommand(['tag', tagName]);
  }

  async pushTag(tagName: string, remoteName = 'origin'): Promise<void> {
    await this.#execGitCommand(['push', remoteName, `refs/tags/${tagName}`]);
  }

  async listTags(): Promise<string[]> {
    const { stdout } = await this.#execGitCommand(['tag', '--list']);
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
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
      const { stdout } = await this.#execGitCommand(['reflog', '--format=%gs', `-n`, String(numOfLastCommands)]);

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
            const allRefs = await this.getAllRefListExtended();
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
