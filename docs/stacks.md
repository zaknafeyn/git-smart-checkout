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
- When the current branch isn't part of any stack, the view shows an empty state with a Refresh button.

## Status Bar Indicator

`$(layers) <position>/<size>` appears immediately to the left of the stash-mode item, but **only** while the current branch is part of a detected stack — it's hidden when stacks are disabled, the extension's status bar is off, HEAD is detached, or the branch simply isn't stacked. The count is of **stacked PRs (or heuristic branches) only** — the target branch doesn't count toward `<size>`, so sitting on the target itself shows no position (there's no PR there). Its tooltip lists the chain top-to-bottom with PR numbers/titles, plus the target branch on its own line. Click it to reveal the Stacks view.

## Detection Sources

Controlled by `git-smart-checkout.stacks.detection`:

| Value | Behavior |
| --- | --- |
| `auto` (default) | GitHub's native Stacks API; falls back to the local ancestry heuristic only when GitHub data is genuinely unavailable (no GitHub remote/token, or the API call fails with no usable cache). |
| `github` | GitHub's Stacks API only — no heuristic fallback. |
| `local` | Local ancestry heuristic only (no GitHub API calls); useful offline or without a GitHub remote. |
| `manual` | No automatic detection. |

GitHub's Stacks API is **authoritative** — the two sources are never merged into one stack. The heuristic (closest ancestor branch by commit distance) is a fallback for when there's no usable GitHub data at all, so it never grafts extra branches onto a genuine stack.

Disable everything with:

```json
"git-smart-checkout.stacks.enabled": false
```
