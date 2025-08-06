import * as https from 'https';
import { authentication } from 'vscode';
import { GitHubPR, GitHubCommit, GitHubCommitFile } from '../../types/dataTypes';

export class GitHubClient {
  private static readonly BASE_URL = 'https://api.github.com';
  private static readonly USER_AGENT = 'git-smart-checkout-vscode-extension';

  constructor(
    private readonly owner: string,
    private readonly repo: string
  ) {}

  private async getAuthToken(): Promise<string | undefined> {
    try {
      const session = await authentication.getSession('github', ['repo'], { createIfNone: true });
      return session.accessToken;
    } catch (error) {
      throw new Error(`GitHub authentication failed: ${error}`);
    }
  }

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const token = await this.getAuthToken();
    const url = `${GitHubClient.BASE_URL}${endpoint}`;
    
    const headers: { [key: string]: string } = {
      'User-Agent': GitHubClient.USER_AGENT,
      'Accept': 'application/vnd.github.v3+json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return new Promise((resolve, reject) => {
      const options = { headers };

      https.get(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Failed to parse JSON response: ${error}`));
            }
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} ${res.statusMessage || 'Unknown error'}`));
          }
        });
      }).on('error', (error) => {
        reject(new Error(`Request error: ${error.message}`));
      });
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
        message: commitData.commit.message
      },
      parents: commitData.parents || [],
      files: commitData.files ? commitData.files.map((file: any): GitHubCommitFile => ({
        filename: file.filename,
        status: file.status as 'added' | 'modified' | 'removed' | 'renamed',
        additions: file.additions || 0,
        deletions: file.deletions || 0
      })) : []
    };
  }

  /**
   * Fetch detailed information for multiple commits including file changes
   */
  public async fetchCommitsDetails(commits: GitHubCommit[]): Promise<GitHubCommit[]> {
    const detailedCommits = await Promise.allSettled(
      commits.map(commit => this.fetchCommitDetails(commit.sha))
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
      repo: this.repo
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
}