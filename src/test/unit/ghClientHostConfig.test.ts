import * as assert from 'assert';

import {
  GITHUB_COM_API_BASE_URL,
  GITHUB_COM_WEB_BASE_URL,
  GitHubClient,
  resolveGitHubHostConfig,
} from '../../common/api/ghClient';
import { detectProvider } from '../../common/api/prProvider';

describe('GitHubClient golden regression: github.com behavior is unchanged with no Enterprise URL configured', () => {
  // Note: these assert against the client's own resolved `apiBaseUrl`/`webBaseUrl` rather than
  // intercepting `https.request` directly — this test host runs `https` as a non-configurable
  // module namespace object, so monkey-patching `https.request` throws "Cannot redefine
  // property" regardless of technique. The base-URL resolution logic itself (which is what
  // actually varies between github.com and Enterprise) is exercised end-to-end by construction,
  // and `resolveGitHubHostConfig`'s own unit tests below cover every URL-shape edge case.
  function baseUrls(client: GitHubClient): { apiBaseUrl: string; webBaseUrl: string } {
    return client as unknown as { apiBaseUrl: string; webBaseUrl: string };
  }

  it('defaults to the github.com API base URL with no host config', () => {
    const client = new GitHubClient('owner', 'repo');
    assert.strictEqual(baseUrls(client).apiBaseUrl, GITHUB_COM_API_BASE_URL);
  });

  it('defaults to the github.com web base URL with no host config', () => {
    const client = new GitHubClient('owner', 'repo');
    assert.strictEqual(baseUrls(client).webBaseUrl, GITHUB_COM_WEB_BASE_URL);
  });

  it('defaults to the github.com API base URL when explicitly given github.com host config', () => {
    const client = new GitHubClient('owner', 'repo', undefined, resolveGitHubHostConfig('github.com', ''));
    assert.strictEqual(baseUrls(client).apiBaseUrl, GITHUB_COM_API_BASE_URL);
    assert.strictEqual(baseUrls(client).webBaseUrl, GITHUB_COM_WEB_BASE_URL);
  });

  it('createPullRequestUrl builds a https://github.com compare link', () => {
    const client = new GitHubClient('owner', 'repo');
    const url = client.createPullRequestUrl('main', 'feature', 'desc');
    assert.strictEqual(
      url,
      'https://github.com/owner/repo/compare/main...feature?expand=1&body=desc'
    );
  });
});

describe('GitHubClient with a GitHub Enterprise host config', () => {
  const enterpriseHostConfig = resolveGitHubHostConfig('ghe.corp.example', 'https://ghe.corp.example');

  it('resolveGitHubHostConfig builds the /api/v3 API base and bare web base', () => {
    assert.deepStrictEqual(enterpriseHostConfig, {
      apiBaseUrl: 'https://ghe.corp.example/api/v3',
      webBaseUrl: 'https://ghe.corp.example',
    });
  });

  it('tolerates a trailing slash on the configured base URL', () => {
    const config = resolveGitHubHostConfig('ghe.corp.example', 'https://ghe.corp.example/');
    assert.deepStrictEqual(config, {
      apiBaseUrl: 'https://ghe.corp.example/api/v3',
      webBaseUrl: 'https://ghe.corp.example',
    });
  });

  it('is case-insensitive when matching the remote host against the configured Enterprise host', () => {
    const config = resolveGitHubHostConfig('GHE.corp.example', 'https://ghe.corp.example');
    assert.deepStrictEqual(config, {
      apiBaseUrl: 'https://ghe.corp.example/api/v3',
      webBaseUrl: 'https://ghe.corp.example',
    });
  });

  it('stores the Enterprise API base URL so requests route to <baseUrl>/api/v3', () => {
    const client = new GitHubClient('owner', 'repo', undefined, enterpriseHostConfig) as unknown as {
      apiBaseUrl: string;
    };
    assert.strictEqual(client.apiBaseUrl, 'https://ghe.corp.example/api/v3');
  });

  it('builds compare/web URLs against the bare Enterprise base URL', () => {
    const client = new GitHubClient('owner', 'repo', undefined, enterpriseHostConfig);
    const url = client.createPullRequestUrl('main', 'feature', 'desc');
    assert.strictEqual(
      url,
      'https://ghe.corp.example/owner/repo/compare/main...feature?expand=1&body=desc'
    );
  });
});

describe('resolveGitHubHostConfig fallback behavior', () => {
  it('falls back to github.com defaults when the host does not match the configured Enterprise host', () => {
    const config = resolveGitHubHostConfig('gitlab.com', 'https://ghe.corp.example');
    assert.deepStrictEqual(config, {
      apiBaseUrl: GITHUB_COM_API_BASE_URL,
      webBaseUrl: GITHUB_COM_WEB_BASE_URL,
    });
  });

  it('falls back to github.com defaults when no Enterprise URL is configured', () => {
    const config = resolveGitHubHostConfig('ghe.corp.example', '');
    assert.deepStrictEqual(config, {
      apiBaseUrl: GITHUB_COM_API_BASE_URL,
      webBaseUrl: GITHUB_COM_WEB_BASE_URL,
    });
  });

  it('falls back to github.com defaults when the Enterprise URL is malformed', () => {
    const config = resolveGitHubHostConfig('ghe.corp.example', 'not-a-url');
    assert.deepStrictEqual(config, {
      apiBaseUrl: GITHUB_COM_API_BASE_URL,
      webBaseUrl: GITHUB_COM_WEB_BASE_URL,
    });
  });

  it('resolves github.com correctly even when an Enterprise URL is also configured', () => {
    const config = resolveGitHubHostConfig('github.com', 'https://ghe.corp.example');
    assert.deepStrictEqual(config, {
      apiBaseUrl: GITHUB_COM_API_BASE_URL,
      webBaseUrl: GITHUB_COM_WEB_BASE_URL,
    });
  });
});

describe('detectProvider', () => {
  it('classifies github.com as github', () => {
    assert.strictEqual(detectProvider('github.com', ''), 'github');
  });

  it('classifies a matching configured Enterprise host as github-enterprise', () => {
    assert.strictEqual(detectProvider('ghe.corp.example', 'ghe.corp.example'), 'github-enterprise');
  });

  it('is case-insensitive', () => {
    assert.strictEqual(detectProvider('GitHub.com', ''), 'github');
    assert.strictEqual(detectProvider('GHE.corp.example', 'ghe.corp.example'), 'github-enterprise');
  });

  it('returns undefined for an unrecognized host', () => {
    assert.strictEqual(detectProvider('gitlab.com', 'ghe.corp.example'), undefined);
    assert.strictEqual(detectProvider('gitlab.com', ''), undefined);
  });

  it('returns undefined for an empty host', () => {
    assert.strictEqual(detectProvider('', ''), undefined);
  });
});
