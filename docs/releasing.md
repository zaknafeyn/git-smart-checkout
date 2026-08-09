# Releasing

Git Smart Checkout publishes to the VS Code Marketplace and Open VSX through two
GitHub Actions workflows, both driven by `semantic-release` (`release.config.js`)
and both manual (`workflow_dispatch`) — nothing publishes automatically on push.

## Two channels, one branch

There is no separate `next`/`beta` branch. Both channels release from `main`;
"pre-release" means *merged to `main` but not yet blessed as stable*, not a
separate line of code.

| | Stable | Pre-release |
|---|---|---|
| Workflow | **Release** (`.github/workflows/release.yml`) | **Pre-release** (`.github/workflows/pre-release.yml`) |
| Version | `major.EVEN.patch` | `major.ODD.patch` |
| Packaging | `vsce package` | `vsce package --pre-release` |
| GitHub release | Latest | marked **Pre-release**, not Latest |

Both lanes share one strictly increasing version sequence and one `v${version}`
git tag line, so a stable release can never collide with or undercut an
already-published pre-release.

## Odd/even minor convention

Following [Microsoft's documented convention](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):
stable releases use an **even** minor, pre-releases use an **odd** minor. The
bump is mechanical:

- **Pre-release run:** last release had an even minor (or none exists yet) →
  bump minor; last minor was already odd → bump patch.
- **Stable run:** last release had an odd minor → force a minor bump (jump
  over the pre-release corridor); otherwise defer to conventional commits as
  usual.

```
stable   0.16.1
pre      0.17.0   first pre-release of the cycle (minor bump)
pre      0.17.1   further pre-releases stay on the odd minor (patch bumps)
pre      0.17.2
stable   0.18.0   cut stable (minor bump, jumps over 0.17.x)
pre      0.19.0   next pre-release cycle opens
```

The bump logic lives in `scripts/nextReleaseType.mjs`, wired into
`release.config.js` as the `analyzeCommitsCmd` for `@semantic-release/exec`.

**Operational rule:** ship stable patches before opening the next pre-release
cycle. Once a pre-release minor (e.g. `0.19.0`) is published, the next stable
release — hotfix or not — jumps to `0.20.0` and carries everything merged to
`main` since the last stable. This is the cost of the single-branch model.

## Running a release

- **Release** — dispatch from the Actions tab on `main`. Runs `semantic-release`
  with `RELEASE_CHANNEL=stable`.
- **Pre-release** — dispatch from the Actions tab on `main`. Runs
  `semantic-release` with `RELEASE_CHANNEL=pre`. Skips publishing (with a log
  message) if there are no commits since the last tag, unless the `force`
  input is set.

Neither workflow requires manual version bumping — `semantic-release` computes
the next version, updates `package.json`/`CHANGELOG.md`, tags, packages the
VSIX, and publishes to both registries in one run.

## Opting in to pre-releases

End users switch channels from the VS Code Extensions view: open the Git Smart
Checkout entry and choose **Switch to Pre-Release Version**. VS Code always
installs the highest version available on the user's channel, so a pre-release
user is still offered later stable releases.
