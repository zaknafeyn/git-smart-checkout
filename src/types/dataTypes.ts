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

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
  };
  parents: { sha: string }[];
}
