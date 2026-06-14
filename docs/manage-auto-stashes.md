# Manage Auto-Stashes

Command: `Git Smart Checkout: Manage auto-stashes...`

Use this command to inspect and recover stashes created by Git Smart Checkout. The manager only lists stash messages beginning with `auto-stash-`; ordinary Git stashes are left out of the picker.

## What It Shows

Each auto-stash entry includes:

- The branch where the stash was created
- How long ago it was created
- The number of changed files
- The complete stash message
- The changed file names, including untracked files

After selecting an auto-stash, choose one of these actions:

| Action | Behavior |
| --- | --- |
| Apply | Restores the changes while keeping the stash available. |
| Pop | Restores the changes and removes the stash when Git succeeds. |
| View Diff | Opens the complete patch in a VS Code diff document, including untracked files. |
| Drop | Permanently deletes the stash after confirmation. |

The picker refreshes after each completed action so you can manage more than one stash without running the command again.

## Safety

Apply and Pop show a warning when the current worktree already has uncommitted changes. Continuing may produce conflicts, which Git leaves in the worktree for you to resolve.

Drop always requires confirmation. Actions use the exact Git stash selector shown by the current repository, so duplicate stash messages cannot cause the wrong entry to be changed.

> [!TIP]
> Use Apply when you want to inspect or recover changes without removing the recovery point. Use Pop only when you are ready for Git to remove the stash after a successful restore.
