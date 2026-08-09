// Two channels share one version line: stable = major.EVEN.patch, pre-release =
// major.ODD.patch (see docs/releasing.md). RELEASE_CHANNEL is set by the two
// dispatchable workflows (release.yml -> 'stable', pre-release.yml -> 'pre') and
// defaults to 'stable' for local/dry-run use.
const channel = process.env.RELEASE_CHANNEL === 'pre' ? 'pre' : 'stable';
const isPre = channel === 'pre';

/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
  branches: ['main'],
  plugins: [
    // Only the stable lane defers to conventional commits. The pre-release lane
    // must be the sole analyzeCommits authority so it can cap the bump at patch
    // while on an odd minor -- semantic-release takes the highest type across all
    // analyzeCommits plugins, so commit-analyzer running here would silently
    // override that cap.
    ...(isPre ? [] : ['@semantic-release/commit-analyzer']),
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md',
    }],
    ['@semantic-release/npm', {
      npmPublish: false,
    }],
    ['@semantic-release/exec', {
      analyzeCommitsCmd: `node scripts/nextReleaseType.mjs ${channel} "\${lastRelease.version}"`,
      // package.json version is already updated by @semantic-release/npm above,
      // so vsce package will embed the correct version in the VSIX filename.
      prepareCmd: `yarn build-all && yarn vsce package --yarn${isPre ? ' --pre-release' : ''}`,
      publishCmd:
        `yarn vsce publish --pat \${process.env.VSCODE_PAT} --packagePath git-smart-checkout-\${nextRelease.version}.vsix${isPre ? ' --pre-release' : ''}` +
        // ovsx ignores/warns on --pre-release for a prepackaged vsix -- the
        // Microsoft.VisualStudio.Code.PreRelease marker baked in by `vsce package
        // --pre-release` above is what Open VSX actually reads.
        ' && yarn ovsx publish --pat ${process.env.OPEN_VSX_PAT} --packagePath git-smart-checkout-${nextRelease.version}.vsix',
      // semantic-release/github has no `prerelease` option and only infers it from
      // its own prerelease-branch mode, which this single-branch design doesn't use.
      ...(isPre && {
        successCmd: 'gh release edit v${nextRelease.version} --prerelease --latest=false',
      }),
    }],
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json'],
      message: isPre
        ? 'chore(pre-release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
        : 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    }],
    ['@semantic-release/github', {
      assets: [{ path: '*.vsix', label: 'VS Code Extension' }],
    }],
  ],
};
