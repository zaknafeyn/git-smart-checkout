# Rebase with Stash

Command: `Git Smart Checkout: Rebase ... (With Stash)`

Use this command to rebase the current branch onto another branch, remote branch, or tag while preserving uncommitted local changes.

## What It Does

1. Reads the current branch.
2. Asks for the stash mode when the configured mode is `manual`.
3. Opens a picker for local branches, remote branches, and tags.
4. Stashes local changes when needed.
5. Runs rebase onto the selected target ref.
6. Restores the stashed changes after a successful rebase.

If the configured stash mode is `autoStashAndPop` or `autoStashAndApply`, the command treats it as "Auto stash in current branch" because rebase happens on the current branch.

## Supported Rebase Stash Modes

| Mode | Behavior |
| --- | --- |
| Auto stash in current branch | Stashes local changes, rebases the current branch, then pops the stash back onto the same branch. |
| No auto stash | Runs rebase without automatic stash handling. Git may block or fail if local changes conflict with the rebase. |

If rebase fails after a stash was created, the command leaves your changes preserved in the stash so you can recover after resolving the rebase state.
