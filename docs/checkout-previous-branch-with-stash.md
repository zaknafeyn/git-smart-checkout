# Checkout Previous Branch with Stash

Command: `Git: Checkout previous branch (With Stash)`

Use this command to return to the previously checked-out branch, similar to `git checkout -`, while applying the same stash protection used by checkout commands.

## What It Does

1. Reads the current branch.
2. Finds the previous branch from Git reflog.
3. Uses the configured stash mode, or asks you to choose one when the mode is `manual`.
4. Checks out the previous branch.
5. Restores, transfers, or skips local changes according to the selected stash mode.

If no previous branch can be found in the reflog, the command exits and shows an informational message.

## Stash Behavior

This command uses the same stash modes as `Git: Checkout to ... (With Stash)`:

- Auto stash in current branch
- Auto stash and pop in new branch
- Auto stash and apply in new branch
- No auto stash

Set the default mode with `Git: Switch Mode` or the status bar item.
