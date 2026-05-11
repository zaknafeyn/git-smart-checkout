# Copy Changes to Worktree

Commands:

- `Git Smart Checkout: Copy staged changes to worktree ...`
- `Git Smart Checkout: Copy WIP changes to worktree ...`
- `Git Smart Checkout: Copy WIP from Worktree`
- `Git Smart Checkout: Move WIP from Worktree`

Use these commands to move local changes between existing Git worktrees without changing branches manually.

## Copy From Current Worktree

The existing `to worktree` commands copy local changes from the current worktree into another selected worktree.

1. Reads linked worktrees from `git worktree list`.
2. Lets you choose a different worktree.
3. Shows whether each available worktree is clean or already has changes.
4. Blocks copying into a dirty target worktree.
5. Copies the selected set of changes.
6. Offers to add the target worktree to the current workspace, open it in the current window, or open it in a new window.

If no other worktrees exist, the command shows a notification and does not create a new worktree.

## Copy Modes

| Command | Behavior |
| --- | --- |
| `Git Smart Checkout: Copy staged changes to worktree ...` | Copies only staged changes. The copied changes are staged in the target worktree too. If nothing is staged, no files are copied and the target worktree can still be opened or added to the workspace. |
| `Git Smart Checkout: Copy WIP changes to worktree ...` | Copies staged changes, unstaged tracked changes, and non-ignored untracked files. Staged changes stay staged in the target worktree, and unstaged changes stay unstaged. |

The source worktree is left unchanged in both modes.

## Copy From Another Worktree

The `from worktree` commands copy WIP changes from a selected linked worktree into the current worktree.

| Command | Behavior |
| --- | --- |
| `Git Smart Checkout: Copy WIP from Worktree` | Copies staged changes, unstaged tracked changes, and non-ignored untracked files from the selected worktree into the current worktree. The selected source worktree is left unchanged. |
| `Git Smart Checkout: Move WIP from Worktree` | Copies the same WIP changes into the current worktree, then resets and cleans the selected source worktree after the copy succeeds. |

If the current worktree already has local changes, the command asks before applying incoming WIP. If the apply or untracked file copy fails, the selected source worktree is not reset.

## Safety Notes

- Target worktrees with existing local changes are shown in the picker but cannot be selected for copying.
- Untracked files are copied only when they do not already exist in the target worktree.
- Ignored files are not copied.
- `Move WIP from Worktree` asks for confirmation before cleaning the selected source worktree.
