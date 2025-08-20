import * as https from 'https';
import { authentication } from 'vscode';

import { EXTENSION_NAME } from '../../const';
import { GitHubCommit, GitHubCommitFile, GitHubPR } from '../../types/dataTypes';

export class GitHubClient {
  private static readonly BASE_URL = 'https://api.github.com';
  private static readonly USER_AGENT = `${EXTENSION_NAME}-vscode-extension`;

  constructor(
    private readonly _owner: string,
    private readonly _repo: string
  ) {}

  get owner(): string {
    return this._owner;
  }

  get repo(): string {
    return this._repo;
  }

  private async getAuthToken(reAuthenticate = false): Promise<string | undefined> {
    try {
      const scope = ['repo'];
      const session = reAuthenticate
        ? await authentication.getSession('github', scope, {
            forceNewSession: true,
            clearSessionPreference: true,
          })
        : await authentication.getSession('github', scope, { createIfNone: true });
      return session.accessToken;
    } catch (error) {
      throw new Error(`GitHub authentication failed: ${error}`);
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    reAuthenticate = false
  ): Promise<T> {
    const token = await this.getAuthToken(reAuthenticate);
    const url = `${GitHubClient.BASE_URL}${endpoint}`;

    const headers: { [key: string]: string } = {
      'User-Agent': GitHubClient.USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
      ['X-GitHub-Api-Version']: '2022-11-28',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    return new Promise((resolve, reject) => {
      const options = {
        method,
        headers,
      };

      const req = https.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode === 403) {
            // todo: add reauthenticate method and retry
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Failed to parse JSON response: ${error}`));
            }
          } else {
            reject(
              new Error(
                `GitHub API error: ${res.statusCode} ${res.statusMessage || 'Unknown error'}\nResponse: ${data}`
              )
            );
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request error: ${error.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Fetch pull request data by PR number
   */
  public async fetchPullRequest(prNumber: number): Promise<GitHubPR> {
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}`;
    return this.makeRequest<GitHubPR>(endpoint);
  }

  /**
   * Fetch all commits for a pull request
   */
  public async fetchPullRequestCommits(prNumber: number): Promise<GitHubCommit[]> {
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/commits`;
    return this.makeRequest<GitHubCommit[]>(endpoint);
  }

  /**
   * Fetch detailed commit information including file changes
   */
  public async fetchCommitDetails(commitSha: string): Promise<GitHubCommit> {
    const endpoint = `/repos/${this.owner}/${this.repo}/commits/${commitSha}`;
    const commitData = await this.makeRequest<any>(endpoint);

    return {
      sha: commitData.sha,
      commit: {
        message: commitData.commit.message,
      },
      parents: commitData.parents || [],
      files: commitData.files
        ? commitData.files.map(
            (file: any): GitHubCommitFile => ({
              filename: file.filename,
              status: file.status as 'added' | 'modified' | 'removed' | 'renamed',
              additions: file.additions || 0,
              deletions: file.deletions || 0,
            })
          )
        : [],
    };
  }

  /**
   * Fetch detailed information for multiple commits including file changes
   */
  public async fetchCommitsDetails(commits: GitHubCommit[]): Promise<GitHubCommit[]> {
    const detailedCommits = await Promise.allSettled(
      commits.map((commit) => this.fetchCommitDetails(commit.sha))
    );

    return detailedCommits.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Return original commit if details fetch fails
        console.warn(`Failed to fetch details for commit ${commits[index].sha}:`, result.reason);
        return commits[index];
      }
    });
  }

  /**
   * Get repository information (owner and repo name)
   */
  public getRepoInfo(): { owner: string; repo: string } {
    return {
      owner: this.owner,
      repo: this.repo,
    };
  }

  /**
   * Create a GitHub URL for creating a new pull request
   */
  public createPullRequestUrl(
    targetBranch: string,
    featureBranch: string,
    description: string
  ): string {
    return `https://github.com/${this.owner}/${this.repo}/compare/${targetBranch}...${featureBranch}?expand=1&body=${encodeURIComponent(description)}`;
  }

  /**
   * Create a new pull request
   */
  public async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    isDraft: boolean = false
  ): Promise<GitHubPR> {
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls`;
    const requestBody = {
      title,
      body,
      head,
      base,
      draft: isDraft,
    };

    return this.makeRequest<GitHubPR>(endpoint, 'POST', requestBody);
  }
}
