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
| Worktree changes | Copy staged changes to worktree…¹ | `Git Smart Checkout: Copy staged changes to worktree...` |
| Worktree changes | Copy WIP changes to worktree…¹ | `Git Smart Checkout: Copy WIP changes to worktree...` |
| Worktree changes | Copy WIP from worktree…¹ | `Git Smart Checkout: Copy WIP from Worktree` |
| Worktree changes | Move WIP from worktree…¹ | `Git Smart Checkout: Move WIP from Worktree` |
| Remove worktrees | Remove worktree…¹ | `Git Smart Checkout: Remove Worktree...` |
| Remove worktrees | Remove multiple worktrees…¹ | `Git Smart Checkout: Remove Multiple Worktrees...` |
| Remove worktrees | Remove PR review worktree…¹ | `Git Smart Checkout: Remove PR review in Worktree` |
| GitHub | Clone pull request… | `Git Smart Checkout: Clone pull request...` |
| Settings | Open settings | `Git Smart Checkout: Open Settings` (opens VS Code Settings filtered to this extension) |

¹ Shown only when the repository is in a state where the action can do
something — see [Conditional actions](#conditional-actions). When none of a
group's actions apply, the group separator is hidden too.

Selecting an action runs the underlying command, so each step behaves exactly as
it does from the command palette. Dismissing the menu (for example with `Esc`)
does nothing.

## Conditional actions

These actions are gated on the repository state and only appear when their
precondition is met (mirroring the guard inside each command):

| Action | Shown when |
| --- | --- |
| Copy staged changes to worktree… | There are staged changes **and** another worktree to copy them into |
| Copy WIP changes to worktree… | There are working-tree (WIP) changes **and** another worktree to copy them into |
| Copy WIP from worktree… | At least one other worktree exists |
| Move WIP from worktree… | At least one other worktree exists |
| Remove worktree… | At least one removable worktree exists |
| Remove multiple worktrees… | At least two removable worktrees exist |
| Remove PR review worktree… | At least one tracked PR-review worktree still exists |

## Status Bar

The status bar item shows the current stash mode and opens this menu on click.
Switching the stash mode is available as the first action. Hide the status bar
item with:

```json
"git-smart-checkout.showStatusBar": false
```
