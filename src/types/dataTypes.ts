export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  /** PR author, as reported by the GitHub REST API. */
  user?: GitHubUser;
  head: {
    ref: string;
    sha: string;
    repo?: {
      full_name: string;
      clone_url: string;
    };
  };
  base: {
    ref: string;
    repo?: {
      full_name: string;
    };
  };
  html_url: string;
  /** PR state as reported by the GitHub REST API. */
  state?: 'open' | 'closed';
  /** Timestamp the PR was merged, or null/undefined if closed without merging (as reported by the GitHub REST API). */
  merged_at?: string | null;
  /** Whether the PR is a draft, as reported by the GitHub REST API. */
  draft?: boolean;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  requested_reviewers?: GitHubUser[];
  requested_teams?: Array<{ slug: string }>;
  /** Total number of commits on the PR (as reported by GitHub). */
  commits?: number;
}

/** A pull request as it appears within a `GitHubStack`'s `pull_requests` array. */
export interface GitHubStackPr {
  number: number;
  state: 'open' | 'closed';
  draft?: boolean;
  merged_at: string | null;
  head: {
    ref: string;
    sha: string;
  };
}

/**
 * A GitHub-native stacked pull request chain, as returned by the Stacks API.
 * @see https://docs.github.com/en/rest/pulls/stacks
 */
export interface GitHubStack {
  id: number;
  number: number;
  node_id: string;
  url: string;
  /** The stack's ultimate target branch — has no PR of its own. */
  base: { ref: string };
  open: boolean;
  created_at: string;
  /** Bottom (closest to `base`) -> top, as ordered by GitHub. */
  pull_requests: GitHubStackPr[];
}

export interface GitHubCommitFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  iconPath?: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
  };
  parents: { sha: string }[];
  files?: GitHubCommitFile[];
}

export interface GitHubLabel {
  id: number;
  name: string;
  description: string | null;
  color: string;
  default: boolean;
}

export interface AppState {
  view: 'input' | 'clone';
  prData?: GitHubPR;
  commits?: GitHubCommit[];
  branches?: string[];
  targetBranch?: string;
}

export interface CommitData {
  sha: string;
  message: string;
  isMergeCommit: boolean;
  files?: GitHubCommitFile[];
}

export interface WebviewMessage {
  command: string;
  [key: string]: any;
}

export interface PrCloneData {
  prInput: string;
  prData?: GitHubPR;
  commits?: GitHubCommit[];
  branches?: string[];
  targetBranch?: string;
  featureBranch: string;
  description: string;
  selectedCommits: string[];
}
