import { ExecException, ExecFileOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LoggingService } from '../../logging/loggingService';
import { execCommand } from '../../utils/execCommand';
import { VscodeGitProvider } from './vscodeGitProvider';
import { IGitRef, IGitStash, IGitWorktree, TUpstreamTrack } from './types';

export function parseGitVersion(output: string): [number, number, number] | undefined {
  const match = output.match(/\bgit version (\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function supportsMergeTreeWriteTree(output: string): boolean {
  const version = parseGitVersion(output);
  if (!version) {
    return false;
  }
  const [major, minor] = version;
  return major > 2 || (major === 2 && minor >= 38);
}

// `git stash show --include-untracked` requires Git >= 2.32; older Git errors
// out on the flag entirely.
export function supportsStashShowIncludeUntracked(output: string): boolean {
  const version = parseGitVersion(output);
  if (!version) {
    return false;
  }
  const [major, minor] = version;
  return major > 2 || (major === 2 && minor >= 32);
}

type StashConflictPreviewError = ExecException & {
  stdout?: string;
  stderr?: string;
};

export function handleStashConflictPreviewError(
  error: StashConflictPreviewError,
  logService: Pick<LoggingService, 'warn'>
): string[] {
  if (error.code !== 1) {
    logService.warn(
      `Stash conflict preview unavailable: git merge-tree exited with code ${String(error.code ?? 'unknown')}.`,
      { stderr: error.stderr ?? '' }
    );
    return [];
  }

  // Exit 1 = conflicts; stdout is "<tree-oid>\nfile1\nfile2\n...".
  const lines = (error.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(1);
}

function stripStashSubjectPrefix(subject: string): string {
  const prefixEnd = subject.indexOf(': ');
  return prefixEnd === -1 ? subject : subject.slice(prefixEnd + 2);
}

function getStashSourceBranch(subject: string): string | undefined {
  const prefixEnd = subject.indexOf(': ');
  if (prefixEnd === -1) {
    return undefined;
  }

  const prefix = subject.slice(0, prefixEnd);
  if (prefix.startsWith('On ')) {
    return prefix.slice(3);
  }
  if (prefix.startsWith('WIP on ')) {
    return prefix.slice(7);
  }

  return undefined;
}

export function parseStashListOutput(output: string): IGitStash[] {
  const fields = output.split('\0');
  const stashes: IGitStash[] = [];

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const selector = fields[index].replace(/^\n+/, '');
    const hash = fields[index + 1];
    const timestamp = Number(fields[index + 2]);
    const subject = fields[index + 3];

    if (!selector || !hash || !Number.isFinite(timestamp)) {
      continue;
    }

    stashes.push({
      selector,
      hash,
      message: stripStashSubjectPrefix(subject),
      sourceBranch: getStashSourceBranch(subject),
      timestamp,
      files: [],
    });
  }

  return stashes;
}

export function parseStashFilesOutput(output: string): string[] {
  return output.split('\0').filter((file) => file.length > 0);
}

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

/**
 * Parses Git's `%(upstream:track)` output into `[ahead, behind]` counts.
 * Missing directions are treated as zero; missing or gone upstreams have no counts.
 */
export function parseUpstreamTrack(upstreamTrack: string): TUpstreamTrack {
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

  const [ahead, behind] = arr.map((item) => Number(item.trim().split(' ')[1]));

  return [ahead, behind];
}

export function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const value = remoteUrl.trim();
  const scpMatch = value.match(/^[^@\s]+@github\.com:([^/\s]+)\/([^/\s]+)\/?$/i);

  let owner: string;
  let repoWithSuffix: string;

  if (scpMatch) {
    [, owner, repoWithSuffix] = scpMatch;
  } else {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com') {
        return null;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length !== 2) {
        return null;
      }

      [owner, repoWithSuffix] = pathParts;
    } catch {
      return null;
    }
  }

  const repo = repoWithSuffix.replace(/\.git$/i, '');
  return owner && repo ? { owner, repo } : null;
}

export class GitExecutor {
  #repositoryPath;
  #logService;
  #vscodeGitProvider: VscodeGitProvider | undefined;
  #mergeTreeSupport?: Promise<boolean>;
  #mergeTreeFallbackLogged = false;
  #stashShowIncludeUntrackedSupport?: Promise<boolean>;

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
    includeRemoteName = true,
    remoteName = 'origin'
  ): Promise<boolean> {
    const ref = includeRemoteName
      ? `refs/remotes/${remoteName}/${branchName}`
      : `refs/remotes/${branchName}`;
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

  async fetchFromUrl(remoteUrl: string, headRef: string, toFetchHead = false) {
    if (toFetchHead) {
      // Git refuses to fetch into the branch that is currently checked out, so
      // fetch to FETCH_HEAD instead of updating the local branch ref directly.
      await this.#execGitCommand(['fetch', remoteUrl, headRef]);
      return;
    }

    // Force the update (`+` prefix) so a subsequent checkout of the same fork PR
    // succeeds even if the PR author force-pushed and the update is otherwise a
    // non-fast-forward. This local branch exists solely to mirror the PR head.
    await this.#execGitCommand(['fetch', remoteUrl, `+${headRef}:${headRef}`]);
  }

  async fetchPullRequestHead(prNumber: number, remoteName = 'origin'): Promise<void> {
    await this.#execGitCommand(['fetch', remoteName, `pull/${prNumber}/head`]);
  }

  async commitExists(sha: string): Promise<boolean> {
    try {
      await this.#execGitCommand(['cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  async pullCurrentBranch() {
    await this.#execGitCommand(['pull']);
  }

  async pullCurrentBranchFfOnly() {
    await this.#execGitCommand(['pull', '--ff-only']);
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
    const remoteBranchExists = await this.#checkRemoteBranchExists(branchName, true, remoteName);

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

    // Get detailed information about the newly created branch.
    // Use the ASCII Unit Separator (\x1f) which cannot occur in ref names,
    // hashes, dates, or (practically) commit subjects, so a `|` in a subject
    // can no longer shift the parsed fields.
    const SEPARATOR = '\x1f';
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
    // Use the ASCII Unit Separator (\x1f) instead of `|`. A commit subject can
    // legitimately contain `|`, which would shift every field parsed after
    // `%(subject)` (corrupting `upstream:track`, author name, etc.). The Unit
    // Separator cannot occur in ref names, hashes, dates, or (practically)
    // commit subjects, and Git passes it through the format string verbatim.
    const SEPARATOR = '\x1f';
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
         * parse remote branches like (\x1f shown here as "|"):
         * refs/heads/feature/add-extension-and-refactoring|8aaf984|Minor fixes|unixTimeStamp|1 2
         * refs/remotes/origin/feature/add-extension-and-refactoring|8aaf984|Minor fixes
         * refs/tags/v1.2.3|8aaf984|Minor fixes
         * */

        // Cap the split at the number of fields in the format string so that an
        // unexpected separator in the final field cannot create extra entries.
        const FIELD_COUNT = 10;
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
        ] = line.split(SEPARATOR, FIELD_COUNT);

        const parsedUpstreamTrack = parseUpstreamTrack(upstreamTrack);

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

  async listRemotes(): Promise<Array<{ name: string; fetchUrl: string; pushUrl: string }>> {
    const { stdout } = await this.#execGitCommand(['remote', '-v']);
    const remotes = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>();
    for (const line of stdout.split('\n')) {
      const match = line.match(/^([^\s]+)\s+(.+)\s+\((fetch|push)\)$/);
      if (!match) continue;
      const current = remotes.get(match[1]) ?? { name: match[1], fetchUrl: '', pushUrl: '' };
      current[match[3] === 'fetch' ? 'fetchUrl' : 'pushUrl'] = match[2];
      remotes.set(match[1], current);
    }
    return [...remotes.values()];
  }

  async getUpstreamRemote(branch: string): Promise<string | undefined> {
    try {
      const { stdout } = await this.#execGitCommand(['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`]);
      return stdout.trim() || undefined;
    } catch { return undefined; }
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
      return {
        index,
        message: stripStashSubjectPrefix(message),
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

  async listStashes(): Promise<IGitStash[]> {
    const { stdout } = await this.#execGitCommand([
      '--no-pager',
      'stash',
      'list',
      '--format=%gd%x00%H%x00%ct%x00%gs%x00',
    ]);
    const stashes = parseStashListOutput(stdout);

    return await Promise.all(
      stashes.map(async (stash) => ({
        ...stash,
        files: await this.getStashFiles(stash.selector),
      }))
    );
  }

  async getStashFiles(selector: string): Promise<string[]> {
    const { stdout } = await this.#execGitCommand([
      'stash',
      'show',
      '--name-only',
      '-z',
      '--include-untracked',
      '--format=',
      selector,
    ]);

    return parseStashFilesOutput(stdout);
  }

  async applyStash(selector: string): Promise<void> {
    await this.#execGitCommand(['stash', 'apply', selector]);
  }

  async popStashBySelector(selector: string): Promise<void> {
    await this.#execGitCommand(['stash', 'pop', selector]);
  }

  async dropStash(selector: string): Promise<void> {
    await this.#execGitCommand(['stash', 'drop', selector]);
  }

  async getStashPatch(selector: string): Promise<string> {
    const includeUntrackedSupported = await this.#supportsStashShowIncludeUntracked();

    const args = ['stash', 'show', '--patch', '--binary'];
    if (includeUntrackedSupported) {
      args.push('--include-untracked');
    }
    args.push('--format=', selector);

    const { stdout } = await this.#execGitCommand(args);

    return includeUntrackedSupported
      ? stdout
      : `${stdout}\n(untracked files not shown: Git 2.32 or newer is required)`;
  }

  async #supportsStashShowIncludeUntracked(): Promise<boolean> {
    this.#stashShowIncludeUntrackedSupport ??= this.#execGitCommand(['--version'])
      .then(({ stdout }) => supportsStashShowIncludeUntracked(stdout))
      .catch(() => false);
    return this.#stashShowIncludeUntrackedSupport;
  }

  async isWorkdirHasChanges() {
    const { stdout } = await this.#execGitCommand(['status', '--porcelain']);
    return stdout.trim().length !== 0;
  }

  /**
   * A `stash@{N}` selector is positional: if any stash is created or removed
   * elsewhere between listing and acting on it, the index can silently point
   * at a different stash. This re-verifies the selector still resolves to the
   * expected commit hash and, if not, re-lists stashes to find the selector
   * that now matches the hash.
   */
  async resolveStashSelector(selector: string, expectedHash: string): Promise<string> {
    try {
      const { stdout } = await this.#execGitCommand(['rev-parse', selector]);
      if (stdout.trim() === expectedHash) {
        return selector;
      }
    } catch {
      // fall through to re-list and resolve by hash
    }

    const stashes = await this.listStashes();
    const match = stashes.find((stash) => stash.hash === expectedHash);
    if (!match) {
      throw new Error('The selected stash no longer exists.');
    }

    return match.selector;
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
      const stashMessages = stashesStrings.map(stripStashSubjectPrefix);

      return stashMessages.some((msg) => msg === message);
    } catch {
      return false;
    }
  }

  async getRemoteUrl(remoteName = 'origin'): Promise<string> {
    const { stdout } = await this.#execGitCommand(['remote', 'get-url', remoteName]);
    return stdout.trim();
  }

  // Predicts tracked-file stash conflicts before any destructive operations by
  // materializing tracked working-tree changes as a temporary commit via
  // `git stash create` (non-destructive; no entry is pushed to refs/stash) and
  // running `git merge-tree` to simulate a 3-way merge onto targetRef.
  // Untracked files are not included in this preview and may still conflict when
  // the real stash, which includes untracked files, is restored. Requires Git >= 2.38.
  async getStashConflictPreview(targetRef: string): Promise<string[]> {
    if (!(await this.#supportsMergeTreeWriteTree())) {
      if (!this.#mergeTreeFallbackLogged) {
        this.#logService.warn(
          'Skipping stash conflict preview because Git 2.38 or newer is required for merge-tree --write-tree.'
        );
        this.#mergeTreeFallbackLogged = true;
      }
      return [];
    }

    const { stdout: stashSha } = await this.#execGitCommand(['stash', 'create']);
    const sha = stashSha.trim();
    if (!sha) {
      return [];
    }

    try {
      await this.#execGitCommand(['merge-tree', '--write-tree', '--name-only', '--no-messages', targetRef, sha]);
      return []; // exit 0 = clean merge, no conflicts
    } catch (error) {
      return handleStashConflictPreviewError(
        error as StashConflictPreviewError,
        this.#logService
      );
    }
  }

  async #supportsMergeTreeWriteTree(): Promise<boolean> {
    this.#mergeTreeSupport ??= this.#execGitCommand(['--version'])
      .then(({ stdout }) => supportsMergeTreeWriteTree(stdout))
      .catch(() => false);
    return this.#mergeTreeSupport;
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
      await this.#execGitCommand(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async isMergeInProgress(): Promise<boolean> {
    try {
      await this.#execGitCommand(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async resetMerge(): Promise<void> {
    await this.#execGitCommand(['reset', '--merge']);
  }

  async deleteLocalBranch(branchName: string) {
    const { stdout } = await this.#execGitCommand(['branch', '-D', branchName]);
    return stdout.trim();
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.#execGitCommand(['branch', force ? '-D' : '-d', name]);
  }

  async deleteRemoteBranch(remote: string, name: string): Promise<void> {
    await this.#execGitCommand(['push', remote, '--delete', name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.#execGitCommand(['branch', '-m', oldName, newName]);
  }

  async deleteTag(name: string): Promise<void> {
    await this.#execGitCommand(['tag', '-d', name]);
  }

  async pushSetUpstream(branch: string): Promise<void> {
    await this.#execGitCommand(['push', '-u', 'origin', branch]);
  }

  async getMergedBranches(base: string): Promise<string[]> {
    const { stdout } = await this.#execGitCommand(['branch', '--merged', base]);
    return stdout.split('\n').map((line) => line.replace(/^\s*[*+]\s*/, '').trim()).filter(Boolean);
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

  async worktreePrune(): Promise<void> {
    await this.#execGitCommand(['worktree', 'prune']);
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

    return await this.#checkRemoteBranchExists(branchName, true);
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
      return parseGitHubRemoteUrl(remoteUrl);
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

  async getRecentBranches(limit: number): Promise<string[]> {
    if (limit <= 0) {
      return [];
    }
    const { stdout } = await this.#execGitCommand(['reflog', '--format=%gs', '-n', '200']);
    const current = await this.getCurrentBranch();
    const stats = new Map<string, { count: number; first: number }>();
    const lines = stdout.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^checkout: moving from (.+) to (.+)$/);
      if (!match) {
        continue;
      }
      const target = match[2].trim();
      if (!target || target === current || target === 'HEAD' || target.includes('detached')) {
        continue;
      }
      const previous = stats.get(target);
      stats.set(target, { count: (previous?.count ?? 0) + 1, first: previous?.first ?? index });
    }
    return [...stats.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
      .slice(0, limit * 2)
      .map(([name]) => name);
  }
}
