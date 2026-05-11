# Pull Rebase with Stash

Command: `Git Smart Checkout: Pull (Rebase With Stash)`

Use this command to pull with rebase while preserving uncommitted local changes.

## What It Does

1. Checks whether the working directory has uncommitted changes.
2. Creates a temporary stash when local changes are present.
3. Runs `git pull --rebase` for the current branch.
4. Restores the stashed changes after the rebase pull completes.

If the pull rebase fails after a stash was created, the command leaves your changes preserved in the stash and reports the failure.

## When To Use It

Use `Git Smart Checkout: Pull (Rebase With Stash)` when your team expects linear history and usually runs `git pull --rebase`.
