# PR Review in Worktree

Commands:

- `Git Smart Checkout: PR Review in Worktree`
- `Git Smart Checkout: Remove PR review in Worktree`

Use these commands to review a GitHub pull request in an isolated Git worktree, then remove that review worktree when you are done.

## What PR Review in Worktree Does

1. Prompts for a PR number or GitHub PR URL.
2. Fetches the pull request metadata from GitHub.
3. Fetches the PR head branch from `origin` or from the fork repository when the PR comes from a fork.
4. Creates a linked worktree for the PR branch.
5. Records the PR number, title, branch, URL, and worktree path so the review worktree can be removed later.

If the PR branch is already checked out in a linked worktree, the command records that worktree and offers the standard worktree completion actions.

## Removing PR Review Worktrees

`Git Smart Checkout: Remove PR review in Worktree` lists only PR review worktrees tracked by this extension. Select a clean worktree and press Enter to remove it immediately.

If the selected worktree has uncommitted changes, the command asks whether to stash changes before removal. When you choose `Stash Changes and Remove`, it asks you to confirm the stash name. The default is:

```text
<worktree_branch_name>_<yyyy-MM-dd_HH-mm-ss>
```

For example:

```text
pr-feature_2026-05-10_14-30-00
```

The command stashes tracked and untracked changes, removes the worktree, removes matching workspace folders, and clears the stored PR review worktree record.

## Limitations

Only worktrees recorded by `Git Smart Checkout: PR Review in Worktree` appear in the removal picker. Manually created worktrees or worktrees created before this tracking feature existed are not listed until the PR review command recognizes the same PR branch.

## Requirements

The current repository remote must point to GitHub so the extension can determine the owner and repository name and fetch pull request metadata.
