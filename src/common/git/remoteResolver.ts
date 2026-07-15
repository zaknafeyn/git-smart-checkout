import { GitExecutor, parseGitHubRemoteUrl } from './gitExecutor';

export interface IGitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export type RemoteResolution = { remote: string } | { needsPick: IGitRemoteInfo[] };

/**
 * Per-repository session memory: once a user has resolved an ambiguous
 * remote pick (via the caller-layer QuickPick), we remember it for the
 * rest of the VS Code session so we don't ask again for the same repo.
 */
const remembered = new Map<string, string>();

export interface ResolveRemoteOptions {
  /** Branch whose configured upstream remote should be preferred, if any. */
  branch?: string;
  /** Value of the `git-smart-checkout.defaultRemote` setting. */
  defaultRemote?: string;
  purpose: 'fetch' | 'push';
}

/**
 * Safely lists remotes for a repository. Falls back to an empty list if the
 * underlying git call fails (e.g. not a git repo yet) or if `git` is a
 * lightweight test double that doesn't implement `listRemotes` — callers
 * treat an empty list the same as "nothing to resolve, use 'origin'".
 */
async function safeListRemotes(git: GitExecutor): Promise<IGitRemoteInfo[]> {
  try {
    return (await git.listRemotes?.()) ?? [];
  } catch {
    return [];
  }
}

async function safeGetUpstreamRemote(git: GitExecutor, branch: string): Promise<string | undefined> {
  try {
    return await git.getUpstreamRemote?.(branch);
  } catch {
    return undefined;
  }
}

/**
 * Resolves which remote should be used for a git operation, following the
 * order documented in the multi-remote support spec:
 *   1. The branch's configured upstream remote.
 *   2. The `defaultRemote` setting, if set and it exists in the repo.
 *   3. If the repo has exactly one remote, that remote.
 *   4. A remembered pick from earlier in this session (for this repo).
 *   5. Otherwise, the caller must prompt the user (`needsPick`).
 *
 * This function is UI-free by design; callers that receive `needsPick`
 * are responsible for prompting the user and calling `rememberRemote`.
 * If remote discovery is unavailable (e.g. `listRemotes` fails or isn't
 * implemented by the caller's `GitExecutor`), it falls back to `'origin'`
 * so existing single-remote-repo behavior is unchanged.
 */
export async function resolveRemote(git: GitExecutor, opts: ResolveRemoteOptions): Promise<RemoteResolution> {
  const remotes = await safeListRemotes(git);
  if (remotes.length === 0) {
    return { remote: 'origin' };
  }

  const available = new Set(remotes.map((remote) => remote.name));

  const upstream = opts.branch ? await safeGetUpstreamRemote(git, opts.branch) : undefined;
  if (upstream && available.has(upstream)) {
    return { remote: upstream };
  }

  if (opts.defaultRemote && available.has(opts.defaultRemote)) {
    return { remote: opts.defaultRemote };
  }

  if (remotes.length === 1) {
    return { remote: remotes[0].name };
  }

  const cached = remembered.get(git.repositoryPath);
  if (cached && available.has(cached)) {
    return { remote: cached };
  }

  return { needsPick: remotes };
}

/** Records the user's answer to an ambiguous remote pick for this repo/session. */
export function rememberRemote(repositoryPath: string, remote: string): void {
  remembered.set(repositoryPath, remote);
}

/** Test-only helper to reset session memory between test cases. */
export function clearRememberedRemotes(): void {
  remembered.clear();
}

export interface ResolveGitHubRemoteOptions extends ResolveRemoteOptions {
  /** `owner/repo` full name of the GitHub repository the operation targets (e.g. a PR's base repo). */
  githubRepo?: string;
}

/**
 * Resolves the remote to use for GitHub-specific flows (PR clone,
 * checkout-by-PR, PR review). When `githubRepo` is provided, remotes whose
 * fetch URL parses (via `parseGitHubRemoteUrl`) to that `owner/repo` are
 * preferred over the generic resolution order — this is what lets a fork
 * setup (`origin` = fork, `upstream` = canonical repo) pick the correct
 * remote for a given PR's base repository.
 */
export async function resolveGitHubRemote(git: GitExecutor, opts: ResolveGitHubRemoteOptions): Promise<RemoteResolution> {
  if (!opts.githubRepo) {
    return resolveRemote(git, opts);
  }

  const remotes = await safeListRemotes(git);
  if (remotes.length === 0) {
    return { remote: 'origin' };
  }

  const matches = remotes.filter((remote) => {
    const parsed = parseGitHubRemoteUrl(remote.fetchUrl);
    return parsed ? `${parsed.owner}/${parsed.repo}`.toLowerCase() === opts.githubRepo!.toLowerCase() : false;
  });

  if (matches.length === 1) {
    return { remote: matches[0].name };
  }

  if (matches.length > 1) {
    // Multiple remotes point at the same GitHub repo (rare) — fall back to
    // the generic resolution order, restricted to the matching remotes.
    const available = new Set(matches.map((remote) => remote.name));
    const upstream = opts.branch ? await safeGetUpstreamRemote(git, opts.branch) : undefined;
    if (upstream && available.has(upstream)) return { remote: upstream };
    if (opts.defaultRemote && available.has(opts.defaultRemote)) return { remote: opts.defaultRemote };
    const cached = remembered.get(git.repositoryPath);
    if (cached && available.has(cached)) return { remote: cached };
    return { needsPick: matches };
  }

  // No remote matches the PR's GitHub repo (e.g. shallow/renamed remotes) —
  // fall back to the generic resolution order across all remotes.
  return resolveRemote(git, opts);
}
