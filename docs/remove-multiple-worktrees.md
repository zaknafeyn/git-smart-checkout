# Remove Multiple Worktrees

Command: `Git Smart Checkout: Remove Multiple Worktrees...`

Use this command to clean up several Git worktrees at once. When you accumulate
many linked worktrees (one per feature branch, PR review, etc.), removing them
one-by-one is tedious — this command lets you check the ones you no longer need
and remove them all in a single action.

For removing a single worktree, use `Git Smart Checkout: Remove Worktree...`
instead.

## When It Is Available

The command appears in the Command Palette only when the repository has **at
least two removable worktrees**. Removable worktrees are all linked worktrees
except the main one, excluding bare and prunable entries. With zero or one
removable worktree, the single `Remove Worktree...` command is sufficient, so
this command stays hidden.

## What It Does

1. Determines the project in the current VS Code workspace (prompts you to pick
   one when the workspace contains multiple projects).
2. Lists the removable worktrees in a **multi-select picker**. Each entry shows
   the branch name (or `Detached at <hash>` for a detached worktree) and the
   worktree's filesystem path.
3. After you check the worktrees you want and press Enter, asks for a single
   confirmation, then removes every selected worktree in one pass.
4. Closes any open workspace folders that point at the removed worktrees.

## Selection and Confirmation

- **Check the worktrees to remove**, then press Enter to confirm the selection.
- **All selected worktrees are clean:** a single confirmation dialog lists the
  worktrees and asks you to confirm before removing them all.
- **One or more selected worktrees have uncommitted changes:** a single dialog
  asks how to handle the changes for *all* dirty worktrees before removal:
  - **Stash Changes and Remove All** — stashes each dirty worktree's changes
    (including untracked files) using an auto-stash named after its branch, then
    removes every selected worktree.
  - **Reset Changes and Remove All** — discards each dirty worktree's changes
    (`git reset --hard` + `git clean -fd`), then removes every selected worktree.
  - **Cancel** — aborts without changing anything.

The chosen policy is applied to every dirty worktree, so you are prompted only
once no matter how many worktrees have changes. Clean worktrees are removed as-is.

## Notes

- Worktrees are detected with `git worktree list`, so the picker always reflects
  the worktrees Git knows about for the selected repository.
- The main worktree, along with bare and prunable worktrees, cannot be selected.
- Removal is best-effort per worktree: if one worktree fails to remove, the
  others still complete and the failures are reported afterwards.
