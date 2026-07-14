import { GitExecutor } from './gitExecutor';

export type RemoteResolution = { remote: string } | { needsPick: Array<{ name: string; fetchUrl: string; pushUrl: string }> };
const remembered = new Map<string, string>();

export async function resolveRemote(git: GitExecutor, opts: { branch?: string; defaultRemote?: string; purpose: 'fetch' | 'push' }): Promise<RemoteResolution> {
  const remotes = await git.listRemotes();
  const available = new Set(remotes.map((remote) => remote.name));
  const upstream = opts.branch ? await git.getUpstreamRemote(opts.branch) : undefined;
  if (upstream && available.has(upstream)) return { remote: upstream };
  if (opts.defaultRemote && available.has(opts.defaultRemote)) return { remote: opts.defaultRemote };
  const cached = remembered.get(git.repositoryPath);
  if (cached && available.has(cached)) return { remote: cached };
  if (remotes.length === 1) return { remote: remotes[0].name };
  return { needsPick: remotes };
}

export function rememberRemote(repositoryPath: string, remote: string): void { remembered.set(repositoryPath, remote); }
