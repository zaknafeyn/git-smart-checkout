# Status Bar Quick Actions

Command: `Git Smart Checkout: Quick Actions`

Clicking the extension status bar item opens a quick-pick menu that gathers the
most common Git Smart Checkout commands in one place, turning the status item
into a hub for the extension. You can also open it from the command palette.

## Actions

| Group | Action | Runs |
| --- | --- | --- |
| Stash mode | Switch stash mode | `Git Smart Checkout: Switch Mode` (the current mode is shown in the description) |
| Checkout | Checkout to… | `Git Smart Checkout: Checkout to ... (With Stash)` |
| Checkout | Checkout previous branch | `Git Smart Checkout: Checkout previous branch (With Stash)` |
| Checkout | Checkout by PR number… | `Git Smart Checkout: Checkout by PR number... (With Stash)` |
| Update branch | Pull (With Stash) | `Git Smart Checkout: Pull (With Stash)` |
| Update branch | Pull (Rebase With Stash) | `Git Smart Checkout: Pull (Rebase With Stash)` |
| Update branch | Rebase (With Stash) | `Git Smart Checkout: Rebase ... (With Stash)` |
| Worktree | Move to new worktree | `Git Smart Checkout: Move to new worktree` |
| Worktree | PR review in worktree… | `Git Smart Checkout: PR Review in Worktree` |
| Worktree | Open worktree dev terminal… | `Git Smart Checkout: Open Worktree Dev Terminal...` |
| Worktree changes | Copy staged changes to worktree… | `Git Smart Checkout: Copy staged changes to worktree...` |
| Worktree changes | Copy WIP changes to worktree… | `Git Smart Checkout: Copy WIP changes to worktree...` |
| Worktree changes | Copy WIP from worktree… | `Git Smart Checkout: Copy WIP from Worktree` |
| Worktree changes | Move WIP from worktree… | `Git Smart Checkout: Move WIP from Worktree` |
| Remove worktrees | Remove worktree… | `Git Smart Checkout: Remove Worktree...` |
| Remove worktrees | Remove multiple worktrees… | `Git Smart Checkout: Remove Multiple Worktrees...` |
| Remove worktrees | Remove PR review worktree… | `Git Smart Checkout: Remove PR review in Worktree` |
| GitHub | Clone pull request… | `Git Smart Checkout: Clone pull request...` |
| Settings | Open settings | `Git Smart Checkout: Open Settings` (opens VS Code Settings filtered to this extension) |

Selecting an action runs the underlying command, so each step behaves exactly as
it does from the command palette. Dismissing the menu (for example with `Esc`)
does nothing.

## Status Bar

The status bar item shows the current stash mode and opens this menu on click.
Switching the stash mode is available as the first action. Hide the status bar
item with:

```json
"git-smart-checkout.showStatusBar": false
```
