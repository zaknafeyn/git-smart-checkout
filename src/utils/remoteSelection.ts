import { QuickPickItem, window } from 'vscode';

import { GitExecutor } from '../common/git/gitExecutor';
import {
  IGitRemoteInfo,
  rememberRemote,
  resolveGitHubRemote,
  resolveRemote,
  ResolveGitHubRemoteOptions,
  ResolveRemoteOptions,
} from '../common/git/remoteResolver';
import { UserCancelledError } from './userCancelledError';

type RemoteQuickPickItem = QuickPickItem & { remoteName: string };

async function pickRemote(remotes: IGitRemoteInfo[], title: string): Promise<string> {
  const items: RemoteQuickPickItem[] = remotes.map((remote) => ({
    label: remote.name,
    description: remote.fetchUrl,
    remoteName: remote.name,
  }));

  const selected = await window.showQuickPick(items, {
    title,
    placeHolder: 'Choose a remote',
  });

  if (!selected) {
    throw new UserCancelledError('No remote selected');
  }

  return selected.remoteName;
}

/**
 * Resolves the remote to use for a git operation, prompting the user with a
 * QuickPick (remembered per-repo for the rest of the session) when the
 * resolution is ambiguous. This is the UI-aware companion to the pure
 * `resolveRemote` in `common/git/remoteResolver.ts`.
 */
export async function resolveRemoteInteractive(
  git: GitExecutor,
  opts: ResolveRemoteOptions,
  title = 'Select Git remote'
): Promise<string> {
  const resolution = await resolveRemote(git, opts);
  if ('remote' in resolution) {
    return resolution.remote;
  }

  const picked = await pickRemote(resolution.needsPick, title);
  rememberRemote(git.repositoryPath, picked);
  return picked;
}

/**
 * Resolves the remote for a GitHub-specific flow (PR clone, checkout-by-PR,
 * PR review), preferring a remote whose URL matches the PR's base repo.
 */
export async function resolveGitHubRemoteInteractive(
  git: GitExecutor,
  opts: ResolveGitHubRemoteOptions,
  title = 'Select Git remote'
): Promise<string> {
  const resolution = await resolveGitHubRemote(git, opts);
  if ('remote' in resolution) {
    return resolution.remote;
  }

  const picked = await pickRemote(resolution.needsPick, title);
  rememberRemote(git.repositoryPath, picked);
  return picked;
}
