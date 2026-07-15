import * as https from 'https';
import { authentication } from 'vscode';

import { EXTENSION_NAME } from '../../const';
import { GitHubCommit, GitHubCommitFile, GitHubLabel, GitHubPR, GitHubUser } from '../../types/dataTypes';
import { detectProvider } from './prProvider';

/**
 * Locations GitHub recognizes for a single pull request template, in priority
 * order. The first non-empty match wins.
 * @see https://docs.github.com/articles/creating-a-pull-request-template-for-your-repository
 */
export const PR_TEMPLATE_CANDIDATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
];

interface GitHubContentsResponse {
  content?: string;
  encoding?: string;
}

interface GitHubApiErrorDetails {
  endpoint: string;
  method: string;
  url: string;
  statusCode?: number;
  statusMessage?: string;
  responseBody?: string;
}

export class GitHubApiError extends Error {
  readonly endpoint: string;
  readonly method: string;
  readonly url: string;
  readonly statusCode?: number;
  readonly statusMessage?: string;
  readonly responseBody?: string;

  constructor(details: GitHubApiErrorDetails) {
    const status = `${details.statusCode ?? 'Unknown status'} ${
      details.statusMessage || 'Unknown error'
    }`;
    const response = details.responseBody ? `\nResponse: ${details.responseBody}` : '';
    super(`GitHub API error: ${status}${response}`);
    this.name = 'GitHubApiError';
    this.endpoint = details.endpoint;
    this.method = details.method;
    this.url = details.url;
    this.statusCode = details.statusCode;
    this.statusMessage = details.statusMessage;
    this.responseBody = details.responseBody;
    Object.setPrototypeOf(this, GitHubApiError.prototype);
  }
}

/**
 * Decode a GitHub "get repository content" response into UTF-8 text. Returns
 * undefined when the payload is not a base64-encoded file (e.g. a directory
 * listing comes back as an array, or the encoding is unexpected).
 */
export const decodeGitHubFileContent = (
  response: GitHubContentsResponse | undefined | null
): string | undefined => {
  if (!response || typeof response.content !== 'string') {
    return undefined;
  }
  if (response.encoding && response.encoding !== 'base64') {
    return undefined;
  }
  try {
    return Buffer.from(response.content, 'base64').toString('utf-8');
  } catch {
    return undefined;
  }
};

/** Default github.com API base URL, used when no Enterprise host matches. */
export const GITHUB_COM_API_BASE_URL = 'https://api.github.com';
/** Default github.com web base URL (compare links, PR URLs, etc). */
export const GITHUB_COM_WEB_BASE_URL = 'https://github.com';

export interface GitHubHostConfig {
  /** Base URL for REST API calls, e.g. `https://api.github.com` or `https://ghe.corp/api/v3`. */
  apiBaseUrl: string;
  /** Base URL for web/compare links, e.g. `https://github.com` or `https://ghe.corp`. */
  webBaseUrl: string;
}

/**
 * Resolve the API/web base URLs to use for a given remote host.
 *
 * `host` is expected to already be validated as either `github.com` or the
 * configured Enterprise host (see `parseGitHubRemoteUrl`); this function
 * still falls back to github.com defaults defensively if it's ever called
 * with an unrecognized host, so a `GitHubClient` is never constructed with
 * an empty base URL.
 */
/** Strips trailing `/` characters without a regex (avoids any polynomial-backtracking risk on untrusted input). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
}

export function resolveGitHubHostConfig(host: string, enterpriseBaseUrl: string): GitHubHostConfig {
  const trimmedEnterpriseUrl = stripTrailingSlashes(enterpriseBaseUrl.trim());
  let enterpriseHost = '';
  if (trimmedEnterpriseUrl) {
    try {
      enterpriseHost = new URL(trimmedEnterpriseUrl).hostname.toLowerCase();
    } catch {
      // Malformed enterprise URL; detectProvider below will fall through to github.com.
    }
  }

  if (detectProvider(host, enterpriseHost) === 'github-enterprise') {
    return { apiBaseUrl: `${trimmedEnterpriseUrl}/api/v3`, webBaseUrl: trimmedEnterpriseUrl };
  }

  return { apiBaseUrl: GITHUB_COM_API_BASE_URL, webBaseUrl: GITHUB_COM_WEB_BASE_URL };
}

export class GitHubClient {
  private static readonly USER_AGENT = `${EXTENSION_NAME}-vscode-extension`;

  /**
   * GitHub's pull request "list commits" endpoint returns at most 250 commits,
   * regardless of pagination. PRs with more commits cannot be fully cloned.
   */
  public static readonly MAX_PR_COMMITS = 250;

  private cachedCurrentUserLogin?: Promise<string | undefined>;
  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;

  constructor(
    private readonly _owner: string,
    private readonly _repo: string,
    private readonly warn: (message: string, error: unknown) => void = (message, error) =>
      console.warn(message, error),
    hostConfig?: GitHubHostConfig
  ) {
    this.apiBaseUrl = hostConfig?.apiBaseUrl ?? GITHUB_COM_API_BASE_URL;
    this.webBaseUrl = hostConfig?.webBaseUrl ?? GITHUB_COM_WEB_BASE_URL;
  }

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
    const url = `${this.apiBaseUrl}${endpoint}`;

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

        res.on('end', async () => {
          if (res.statusCode && res.statusCode === 403) {
            // Check if this is a SAML enforcement error and we haven't already retried with re-auth
            if (!reAuthenticate && data.includes('Resource protected by organization SAML enforcement')) {
              try {
                // Retry with re-authentication
                const result = await this.makeRequest<T>(endpoint, method, body, true);
                resolve(result);
                return;
              } catch (retryError) {
                // If re-authentication fails, throw the retry error instead of the original
                reject(retryError);
                return;
              }
            }
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Failed to parse JSON response: ${error}`));
            }
          } else {
            reject(
              new GitHubApiError({
                endpoint,
                method,
                url,
                statusCode: res.statusCode,
                statusMessage: res.statusMessage,
                responseBody: data,
              })
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
   * Perform a paginated GET request, following pages until a partial page is
   * returned. Defaults to the maximum page size GitHub allows (100).
   */
  private async makePaginatedRequest<T>(endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const sep = endpoint.includes('?') ? '&' : '?';
      const batch = await this.makeRequest<T[]>(
        `${endpoint}${sep}per_page=${perPage}&page=${page}`
      );
      results.push(...batch);
      if (batch.length < perPage) {
        break;
      }
      page++;
    }

    return results;
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
    return this.makePaginatedRequest<GitHubCommit>(endpoint);
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
    return `${this.webBaseUrl}/${this.owner}/${this.repo}/compare/${targetBranch}...${featureBranch}?expand=1&body=${encodeURIComponent(description)}`;
  }

  /**
   * Create a new pull request
   */
  public async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    isDraft: boolean = false,
    labels?: string[],
    assignees?: string[],
    reviewers?: string[],
    teamReviewers?: string[]
  ): Promise<GitHubPR> {
    const endpoint = `/repos/${this.owner}/${this.repo}/pulls`;
    const requestBody: any = {
      title,
      body,
      head,
      base,
      draft: isDraft,
    };

    const newPr = await this.makeRequest<GitHubPR>(endpoint, 'POST', requestBody);

    if (labels?.length) {
      try {
        await this.makeRequest(
          `/repos/${this.owner}/${this.repo}/issues/${newPr.number}/labels`,
          'POST',
          { labels }
        );
      } catch (error) {
        this.warn(`Failed to copy labels to PR #${newPr.number}:`, error);
      }
    }

    if (assignees?.length) {
      try {
        await this.makeRequest(
          `/repos/${this.owner}/${this.repo}/issues/${newPr.number}/assignees`,
          'POST',
          { assignees }
        );
      } catch (error) {
        this.warn(`Failed to copy assignees to PR #${newPr.number}:`, error);
      }
    }

    if (reviewers?.length || teamReviewers?.length) {
      try {
        await this.makeRequest(
          `/repos/${this.owner}/${this.repo}/pulls/${newPr.number}/requested_reviewers`,
          'POST',
          { reviewers, team_reviewers: teamReviewers }
        );
      } catch (error) {
        this.warn(`Failed to copy reviewers to PR #${newPr.number}:`, error);
      }
    }

    return newPr;
  }

  /**
   * Fetch (and cache) the login of the currently authenticated GitHub user.
   * Used to filter the authenticated user out of reviewer lists, since GitHub
   * rejects requests where a PR author is requested as their own reviewer.
   */
  public async getCurrentUserLogin(): Promise<string | undefined> {
    if (!this.cachedCurrentUserLogin) {
      this.cachedCurrentUserLogin = this.makeRequest<GitHubUser>('/user')
        .then((user) => user.login)
        .catch((error) => {
          this.warn('Failed to fetch authenticated GitHub user:', error);
          return undefined;
        });
    }
    return this.cachedCurrentUserLogin;
  }

  /**
   * Fetch all labels from the repository
   */
  public async fetchLabels(): Promise<GitHubLabel[]> {
    const endpoint = `/repos/${this.owner}/${this.repo}/labels`;
    return this.makePaginatedRequest<GitHubLabel>(endpoint);
  }

  /**
   * Fetch the repository's pull request template, if one exists.
   *
   * Probes the locations GitHub recognizes for a single template and returns
   * the first non-empty match (in priority order). Missing templates surface as
   * 404s, which are expected and swallowed; this method returns undefined when
   * no template is found.
   */
  public async fetchPullRequestTemplate(): Promise<string | undefined> {
    const responses = await Promise.allSettled(
      PR_TEMPLATE_CANDIDATE_PATHS.map((path) =>
        this.makeRequest<GitHubContentsResponse>(
          `/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`
        )
      )
    );

    for (const result of responses) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      const decoded = decodeGitHubFileContent(result.value);
      if (decoded && decoded.trim().length > 0) {
        return decoded;
      }
    }

    return undefined;
  }
}
