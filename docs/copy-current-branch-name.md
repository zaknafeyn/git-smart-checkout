# Copy Current Branch Name

Command: `Git Smart Checkout: Copy current branch name to clipboard`

Use this command to copy the name of the currently checked-out branch to the clipboard, similar to running `git branch --show-current | pbcopy`.

## What It Does

1. Reads the current branch name.
2. Copies it to the system clipboard.
3. Shows a notification confirming what was copied that auto-dismisses after 5 seconds.

If the current workspace is not a git repository (or no branch can be determined, e.g. a detached HEAD), the command shows an error message instead.
