# Stacks

Command: `Git Smart Checkout: Refresh Stacks`

Detects the GitHub-native [stacked pull request](https://docs.github.com/en/rest/pulls/stacks) chain the current branch belongs to and shows it in the "Stacks" view (Git Smart Checkout activity bar container), alongside a status bar indicator.

## What Counts as a Stack

A stack is whatever GitHub's Stacks API says it is: `GET /repos/{owner}/{repo}/stacks` returns each stack's member PRs (bottom -> top, already ordered by GitHub) and its **target** branch (`base.ref`) — the branch the stack is ultimately aimed at, which has no open PR of its own (often `main`, but it can be any branch — a release branch, another feature branch, etc.). For example:

```
PR #52  vradchuk/feature-1-for-release-v1.1
PR #12  test/feature-1-for-release-v1
        test/fake-release-v1                   <- target (no open PR)
```

Whether a single PR onto trunk counts as a stack, how forks in history are resolved, and stack member order are all decisions GitHub itself made when the stack was created — this extension doesn't second-guess them by walking PR `head`/`base` refs locally.

## The Stacks View

Shows the stack containing the **current branch**, top PR first, target branch as a chip at the bottom. Each row shows the PR title and `#number · branch`; the current branch/target is highlighted.

- **Click a row (or the target chip)** to check out that branch, using whichever [stash mode](switch-mode.md) is currently active — including the manual prompt if that's what's configured.
- **Right-click a row** (or use the inline external-link icon) for "Open PR in Browser".
- The target chip shows **⇡N ⇣N** (commits waiting to be pushed / commits to pull), read directly from the branch's upstream tracking info — the same convention as the Worktrees view — whenever the target branch has an upstream configured. Next to it, a **fetch icon (⟳, "Fetch latest changes")** fetches the target branch from its remote (updating the remote-tracking ref only, no checkout, no merge) and refreshes the indicator.
- The **refresh icon (⟳)** in the view's title bar re-fetches the current branch's stack status from GitHub on demand — useful right after a stack changes on GitHub (a PR merged, or the stack was reordered/dissolved), since nothing is cached locally.
- When the current branch isn't part of any stack, the view shows an empty state with a Refresh button.

## Status Bar Indicator

`$(layers) <position>/<size>` appears immediately to the left of the stash-mode item, but **only** while the current branch is part of a detected stack — it's hidden when stacks are disabled, the extension's status bar is off, HEAD is detached, or the branch simply isn't stacked. The count is of **stacked PRs only** — the target branch doesn't count toward `<size>`, so sitting on the target itself shows no position (there's no PR there). Its tooltip lists the chain top-to-bottom with PR numbers/titles, plus the target branch on its own line. Click it to reveal the Stacks view.

## Detection

Detection is automatic and always on for GitHub repositories, with no configuration knob: whenever the current branch is the target or a stacked PR's head in one of the repository's stacks (as reported live by `GET /repos/{owner}/{repo}/stacks`), it shows up. Nothing is cached — a stack can be reordered or dissolved on GitHub at any time, so every refresh re-fetches live rather than risking a stale view.

Disable everything with:

```json
"git-smart-checkout.stacks.enabled": false
```
