import * as assert from 'assert';

import { parseGitHubRemoteUrl } from '../../common/git/gitExecutor';

describe('parseGitHubRemoteUrl', () => {
  const cases: Array<[string, { owner: string; repo: string; host: string }]> = [
    ['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo', host: 'github.com' }],
    ['https://github.com/owner/repo', { owner: 'owner', repo: 'repo', host: 'github.com' }],
    ['https://github.com/owner/repo.git', { owner: 'owner', repo: 'repo', host: 'github.com' }],
    ['https://github.com/owner/next.js', { owner: 'owner', repo: 'next.js', host: 'github.com' }],
    ['git@github.com:owner/my.repo.name.git', { owner: 'owner', repo: 'my.repo.name', host: 'github.com' }],
  ];

  for (const [remoteUrl, expected] of cases) {
    it(`parses ${remoteUrl}`, () => {
      assert.deepStrictEqual(parseGitHubRemoteUrl(remoteUrl), expected);
    });
  }

  it('supports URL-form SSH remotes and trailing slashes', () => {
    assert.deepStrictEqual(
      parseGitHubRemoteUrl('ssh://git@github.com/owner/my.repo.git/'),
      { owner: 'owner', repo: 'my.repo', host: 'github.com' }
    );
  });

  it('rejects non-GitHub and malformed remote URLs when no Enterprise host is configured', () => {
    assert.strictEqual(parseGitHubRemoteUrl('https://github.example.com/owner/repo.git'), null);
    assert.strictEqual(parseGitHubRemoteUrl('https://github.com/owner/repo/extra'), null);
    assert.strictEqual(parseGitHubRemoteUrl('not a remote'), null);
  });

  describe('GitHub Enterprise host support', () => {
    const enterpriseBaseUrl = 'https://ghe.corp.example';

    it('accepts HTTPS remotes matching the configured Enterprise host', () => {
      assert.deepStrictEqual(
        parseGitHubRemoteUrl('https://ghe.corp.example/owner/repo.git', enterpriseBaseUrl),
        { owner: 'owner', repo: 'repo', host: 'ghe.corp.example' }
      );
    });

    it('accepts SCP-style SSH remotes matching the configured Enterprise host', () => {
      assert.deepStrictEqual(
        parseGitHubRemoteUrl('git@ghe.corp.example:owner/repo.git', enterpriseBaseUrl),
        { owner: 'owner', repo: 'repo', host: 'ghe.corp.example' }
      );
    });

    it('is case-insensitive and tolerates a trailing slash on the configured base URL', () => {
      assert.deepStrictEqual(
        parseGitHubRemoteUrl('https://GHE.corp.example/owner/repo.git', 'https://ghe.corp.example/'),
        { owner: 'owner', repo: 'repo', host: 'ghe.corp.example' }
      );
    });

    it('still accepts github.com remotes when an Enterprise host is configured', () => {
      assert.deepStrictEqual(
        parseGitHubRemoteUrl('https://github.com/owner/repo.git', enterpriseBaseUrl),
        { owner: 'owner', repo: 'repo', host: 'github.com' }
      );
    });

    it('rejects a host that matches neither github.com nor the configured Enterprise host', () => {
      assert.strictEqual(
        parseGitHubRemoteUrl('https://gitlab.com/owner/repo.git', enterpriseBaseUrl),
        null
      );
    });

    it('ignores a malformed Enterprise base URL and falls back to github.com-only matching', () => {
      assert.strictEqual(
        parseGitHubRemoteUrl('https://ghe.corp.example/owner/repo.git', 'not-a-url'),
        null
      );
    });
  });
});
