/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md',
    }],
    ['@semantic-release/npm', {
      npmPublish: false,
    }],
    ['@semantic-release/exec', {
      // package.json version is already updated by @semantic-release/npm above,
      // so vsce package will embed the correct version in the VSIX filename.
      prepareCmd: 'yarn build-all && yarn vsce package --yarn',
      publishCmd:
        'yarn vsce publish --pat ${VSCODE_PAT} git-smart-checkout-${nextRelease.version}.vsix' +
        ' && yarn ovsx publish --pat ${OPEN_VSX_PAT} git-smart-checkout-${nextRelease.version}.vsix',
    }],
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json'],
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    }],
    ['@semantic-release/github', {
      assets: [{ path: '*.vsix', label: 'VS Code Extension' }],
    }],
  ],
};
