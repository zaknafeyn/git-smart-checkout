# Open Worktree Dev Terminal

Command: `Git Smart Checkout: Open Worktree Dev Terminal...`

Use this command to quickly open a new integrated terminal in the directory of any of your repository's Git worktrees. This is handy when you keep multiple worktrees of the same repository (for example, one per feature branch or PR) and want a shell in the right working directory without navigating there manually.

## What It Does

1. Determines the projects in the current VS Code workspace.
2. If the workspace contains more than one project (workspace folder), prompts you to select a project first.
3. Lists the Git worktrees for the selected project, including the current one.
4. Opens a new default VS Code terminal whose working directory is the selected worktree's location on disk.

## Selection Behavior

- **Single project, single worktree:** The command behaves like opening a plain terminal — it opens a new terminal in the project directory without prompting.
- **Single project, multiple worktrees:** The command shows a picker of all worktrees. The worktree you are currently in is marked with `(current)` and listed first. Each entry shows the branch name (or `(detached HEAD)` for a detached worktree) and the worktree's filesystem path.
- **Multiple projects:** The command first asks you to choose a project, then applies the worktree behavior above for that project.

Selecting a worktree and pressing Enter opens a new terminal in that worktree's directory. The terminal is named after the worktree's branch (or directory name when the branch cannot be determined).

## Notes

- The command always creates a **new** terminal; it does not reuse an existing one.
- Worktrees are detected with `git worktree list`, so the list always reflects the worktrees that Git knows about for the selected repository.
