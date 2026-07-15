/**
 * Provider host classification — Phase 1 scope (GitHub + GitHub Enterprise
 * only). This is the extension point future phases (GitLab, Bitbucket) would
 * broaden; for now, any host that isn't github.com or the configured
 * Enterprise host is treated as unsupported rather than guessed at, since
 * routing requests to the wrong API shape (e.g. GitLab's REST API) would be
 * worse than a clear error. See `resolveGitHubHostConfig` in `ghClient.ts`
 * and `parseGitHubRemoteUrl` in `gitExecutor.ts`, which use this.
 */
export type ProviderKind = 'github' | 'github-enterprise';

/**
 * Classify a remote hostname into a supported provider kind.
 *
 * @param host lowercase hostname parsed from the git remote URL.
 * @param enterpriseHost lowercase hostname extracted from the configured
 *   `git-smart-checkout.githubEnterpriseBaseUrl` setting, or '' when unset.
 * @returns the matched provider kind, or `undefined` when the host is
 *   neither github.com nor the configured Enterprise host.
 */
export function detectProvider(host: string, enterpriseHost: string): ProviderKind | undefined {
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return undefined;
  }
  if (normalizedHost === 'github.com') {
    return 'github';
  }
  if (enterpriseHost && normalizedHost === enterpriseHost) {
    return 'github-enterprise';
  }
  return undefined;
}

/**
 * Refspec for fetching a pull request's head ref. Identical for github.com
 * and GitHub Enterprise (both are GitHub REST API v3), so Phase 1 doesn't
 * need per-provider branching here — this stays a named export so a future
 * provider with a different refspec shape (e.g. GitLab's
 * `merge-requests/<n>/head`) has an obvious place to branch.
 */
export function prHeadRefspec(_kind: ProviderKind, prNumber: number): string {
  return `pull/${prNumber}/head`;
}
