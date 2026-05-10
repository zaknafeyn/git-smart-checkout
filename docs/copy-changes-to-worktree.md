# Copy Changes to Worktree

Commands:

- `Git: Copy staged changes to worktree ...`
- `Git: Copy WIP changes to worktree ...`

Use these commands to copy local changes from the current worktree into another existing Git worktree without removing or changing the source worktree's changes.

## What It Does

1. Reads the existing linked worktrees from `git worktree list`.
2. Lets you choose a different worktree.
3. Shows whether each available worktree is clean or already has changes.
4. Blocks copying into a dirty target worktree.
5. Copies the selected set of changes.
6. Offers to add the target worktree to the current workspace, open it in the current window, or open it in a new window.

If no other worktrees exist, the command shows a notification and does not create a new worktree.

## Copy Modes

| Command | Behavior |
| --- | --- |
| `Git: Copy staged changes to worktree ...` | Copies only staged changes. The copied changes are staged in the target worktree too. If nothing is staged, no files are copied and the target worktree can still be opened or added to the workspace. |
| `Git: Copy WIP changes to worktree ...` | Copies staged changes, unstaged tracked changes, and non-ignored untracked files. Staged changes stay staged in the target worktree, and unstaged changes stay unstaged. |

The source worktree is left unchanged in both modes.

## Safety Notes

- Target worktrees with existing local changes are shown in the picker but cannot be selected for copying.
- Untracked files are copied only when they do not already exist in the target worktree.
- Ignored files are not copied.
