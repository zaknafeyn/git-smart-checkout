# Pull with Stash

Command: `Git Smart Checkout: Pull (With Stash)`

Use this command to pull updates for the current branch while preserving uncommitted local changes.

## What It Does

1. Checks whether the working directory has uncommitted changes.
2. Creates a temporary stash when local changes are present.
3. Runs a normal `git pull` for the current branch.
4. Restores the stashed changes after the pull completes.

If the pull fails after a stash was created, the command leaves your changes preserved in the stash and reports the failure.

## When To Use It

Use `Git Smart Checkout: Pull (With Stash)` when your team uses merge pulls or when you want the same behavior as `git pull`, but without manually stashing and popping local work.
