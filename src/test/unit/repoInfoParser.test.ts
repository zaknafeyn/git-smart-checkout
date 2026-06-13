import * as assert from 'assert';

import { parseGitHubRemoteUrl } from '../../common/git/gitExecutor';

describe('parseGitHubRemoteUrl', () => {
  const cases: Array<[string, { owner: string; repo: string }]> = [
    ['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/next.js', { owner: 'owner', repo: 'next.js' }],
    ['git@github.com:owner/my.repo.name.git', { owner: 'owner', repo: 'my.repo.name' }],
  ];

  for (const [remoteUrl, expected] of cases) {
    it(`parses ${remoteUrl}`, () => {
      assert.deepStrictEqual(parseGitHubRemoteUrl(remoteUrl), expected);
    });
  }

  it('supports URL-form SSH remotes and trailing slashes', () => {
    assert.deepStrictEqual(
      parseGitHubRemoteUrl('ssh://git@github.com/owner/my.repo.git/'),
      { owner: 'owner', repo: 'my.repo' }
    );
  });

  it('rejects non-GitHub and malformed remote URLs', () => {
    assert.strictEqual(parseGitHubRemoteUrl('https://github.example.com/owner/repo.git'), null);
    assert.strictEqual(parseGitHubRemoteUrl('https://github.com/owner/repo/extra'), null);
    assert.strictEqual(parseGitHubRemoteUrl('not a remote'), null);
  });
});
