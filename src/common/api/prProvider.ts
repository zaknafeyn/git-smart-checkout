export interface ProviderPR {
  number: number;
  title: string;
  htmlUrl: string;
  head: { ref: string; sha: string };
  base: { ref: string; repo: string };
}

export interface PrProvider {
  parseRemoteUrl(url: string): { owner: string; repo: string } | null;
  prHeadRefspec(number: number): string;
}

export type ProviderKind = 'github' | 'github-enterprise' | 'gitlab' | 'bitbucket';

export function detectProvider(remoteUrl: string): ProviderKind | 'unsupported' {
  let host = '';
  try { host = new URL(remoteUrl.replace(/^git@([^:]+):/, 'https://$1/')).hostname.toLowerCase(); } catch { return 'unsupported'; }
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com' || host.includes('gitlab')) return 'gitlab';
  if (host === 'bitbucket.org' || host.includes('bitbucket')) return 'bitbucket';
  if (host) return 'github-enterprise';
  return 'unsupported';
}

export function providerHeadRefspec(kind: ProviderKind, number: number): string {
  if (kind === 'gitlab') return `merge-requests/${number}/head`;
  if (kind === 'bitbucket') return `pull-requests/${number}/from`;
  return `pull/${number}/head`;
}
