# Checkout by PR Number with Stash

Command: `Git Smart Checkout: Checkout by PR number... (With Stash)`

Use this command to switch directly to a GitHub pull request branch by entering a PR number or URL. The checkout uses the same stash behavior as the other checkout commands.

## Accepted Input

- Plain number: `123`
- Hash-prefixed number: `#123`
- Full GitHub PR URL: `https://github.com/owner/repo/pull/123`

## What It Does

1. Prompts for a PR number or GitHub PR URL.
2. Reads the current repository's GitHub remote information.
3. Fetches the pull request metadata from GitHub.
4. Fetches the PR head branch from `origin` or from the fork repository when the PR comes from a fork.
5. Uses the configured stash mode, or asks you to choose one when the mode is `manual`.
6. Checks out the PR branch and restores or transfers local changes according to the selected stash mode.

> [!TIP]
> Stash behavior is controlled by the same mode setting used by `Git Smart Checkout: Checkout to ... (With Stash)`. Set it once with `Git Smart Checkout: Switch Mode` or the status bar item, and checkout commands follow it automatically.

## Requirements

The current repository remote must point to GitHub so the extension can determine the owner and repository name.
