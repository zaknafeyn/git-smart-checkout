export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  html_url: string;
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

export interface AppState {
  view: 'input' | 'clone';
  prData?: GitHubPR;
  commits?: GitHubCommit[];
  branches?: string[];
  targetBranch?: string;
  defaultTargetBranch?: string;
  isCloning?: boolean;
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
